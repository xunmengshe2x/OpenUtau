using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using OpenUtau.Core;
using OpenUtau.Core.DiffSinger;
using OpenUtau.Core.Format;
using OpenUtau.Core.Render;
using OpenUtau.Core.Ustx;
using OpenUtau.Api;
using OpenUtau.Core.Util;
using OpenUtau.Classic;

namespace OpenUtau.Cli {
    public class VerseAnalyzer {
        public static void AnalyzeVerses(string ustxPath) {
            Console.WriteLine("============================================================");
            Console.WriteLine("OpenUtau C# Verse Analysis - Real Implementation");
            Console.WriteLine("============================================================");

            try {
                // Initialize systems like working CLI
                Console.WriteLine("🔧 Initializing OpenUtau systems...");
                
                // Support non-UTF8 encodings
                System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
                
                // Set up local singer path if it exists
                var inputDir = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(ustxPath));
                var localSingerPath = System.IO.Path.Combine(inputDir ?? string.Empty, "fem_1_ln");
                if (System.IO.Directory.Exists(localSingerPath)) {
                    Preferences.Default.AdditionalSingerPath = localSingerPath;
                    Preferences.Default.InstallToAdditionalSingersPath = true;
                    Console.WriteLine($"✅ Found local singer path: {localSingerPath}");
                }
                
                // Initialize managers in correct order
                SingerManager.Inst.Initialize();
                ToolsManager.Inst.Initialize();
                
                // Register plugins
                DocManager.Inst.SearchAllPlugins();
                DocManager.Inst.SearchAllLegacyPlugins();
                DocManager.Inst.Initialize(System.Threading.Thread.CurrentThread, System.Threading.Tasks.TaskScheduler.Current);
                
                // Load USTX using OpenUtau's actual loader
                var project = Ustx.Load(ustxPath);
                if (project == null) {
                    Console.WriteLine($"❌ Failed to load {ustxPath}");
                    return;
                }

                Console.WriteLine($"✅ Loaded: {project.name}");
                Console.WriteLine($"   Resolution: {project.resolution}");
                Console.WriteLine($"   Tracks: {project.tracks.Count}");
                Console.WriteLine($"   Parts: {project.parts.Count}");
                
                // Set up singers properly
                var singers = SingerManager.Inst.Singers.Values.ToList();
                Console.WriteLine($"   Available singers: {singers.Count}");
                
                // Debug: Show all available singers
                foreach (var singer in singers) {
                    Console.WriteLine($"   Available: {singer.Name} (ID: {singer.Id}, Type: {singer.GetType().Name})");
                }
                
                // Find the fem_1_ln singer (try multiple ways)
                var fem1Singer = singers.FirstOrDefault(s => 
                    s.Id == "." ||  // DiffSinger singers often have "." as ID
                    s.Id == "fem_1_ln" || 
                    s.Id == "fem_1" ||
                    s.Name == "fem_1" ||
                    s.Name == "fem_1_ln" ||
                    s.Name.Contains("FEM") ||
                    s.Name.Contains("fem") ||
                    s.Id.Contains("fem"));
                    
                if (fem1Singer != null) {
                    Console.WriteLine($"✅ Found singer: {fem1Singer.Name} (ID: {fem1Singer.Id})");
                    
                    // Set singer on all tracks
                    foreach (var part in project.parts.OfType<UVoicePart>()) {
                        var track = project.tracks[part.trackNo];
                        track.Singer = fem1Singer;
                        
                        // Phonemizer should be set by the track already
                        if (track.Phonemizer != null) {
                            Console.WriteLine($"   Track has phonemizer: {track.Phonemizer.GetType().Name}");
                        } else {
                            Console.WriteLine($"   No phonemizer on track {part.trackNo}");
                        }
                        
                        Console.WriteLine($"   Assigned singer to track {part.trackNo}");
                    }
                } else {
                    Console.WriteLine("⚠️ fem_1_ln singer not found");
                    // Still try to use whatever singer exists
                    if (singers.Count > 0) {
                        var defaultSinger = singers.First();
                        Console.WriteLine($"   Using first available singer: {defaultSinger.Name}");
                        foreach (var part in project.parts.OfType<UVoicePart>()) {
                            var track = project.tracks[part.trackNo];
                            track.Singer = defaultSinger;
                        }
                    }
                }

                // Process each voice part using OpenUtau's rendering system
                foreach (var part in project.parts.OfType<UVoicePart>()) {
                    AnalyzePart(project, part);
                }

            } catch (Exception e) {
                Console.WriteLine($"❌ Error: {e.Message}");
                Console.WriteLine($"   Stack: {e.StackTrace}");
            }
        }

        private static void AnalyzePart(UProject project, UVoicePart part) {
            var track = project.tracks[part.trackNo];
            
            Console.WriteLine($"\n📝 ANALYZING PART: {part.name}");
            Console.WriteLine($"   Track: {track.Singer?.Name ?? "No Singer"}");
            Console.WriteLine($"   Notes: {part.notes.Count}");

            // Show how OpenUtau separates lyrical notes from phonemes
            ShowNoteSeparation(project, track, part);

            // Generate render phrases EXACTLY like the working CLI does it
            GenerateAndShowRenderPhrases(project, part, track);
        }
        
        private static void GenerateAndShowRenderPhrases(UProject project, UVoicePart part, UTrack track) {
            Console.WriteLine($"\n🔧 GENERATING RENDER PHRASES (CLI Method):");
            
            try {
                // EXACTLY like the CLI does it (lines 576-582 in Program.cs)
                Console.WriteLine($"   Part has {part.notes.Count} notes, {part.phonemes.Count} phonemes");
                Console.WriteLine($"   Track singer: {track.Singer?.Name ?? "null"}");
                
                // Validate renderer settings first
                track.RendererSettings.Validate(track);
                
                // Generate render phrases using the EXACT same method as CLI
                var renderPhrases = RenderPhrase.FromPart(project, track, part).ToList();
                Console.WriteLine($"   Generated {renderPhrases.Count} render phrases\n");
                
                // Store them in the part like CLI does
                part.renderPhrases = renderPhrases;
                
                // Show the phrases
                ShowRealDiffSingerPhrases(renderPhrases);
                
            } catch (Exception e) {
                Console.WriteLine($"   ❌ Error: {e.Message}");
                Console.WriteLine($"   Stack: {e.StackTrace}");
            }
        }
        
        private static List<SimulatedPhrase> CreateSimulatedPhrases(UProject project, List<UNote> lyricalNotes) {
            var phrases = new List<SimulatedPhrase>();
            if (!lyricalNotes.Any()) return phrases;
            
            int startIndex = 0;
            int phraseNumber = 1;
            
            for (int i = 1; i < lyricalNotes.Count; i++) {
                var prevNote = lyricalNotes[i - 1];
                var currNote = lyricalNotes[i];
                
                // Calculate gap in ticks (like RenderPhrase.FromPart logic)
                var prevEnd = prevNote.position + prevNote.duration;
                var currStart = currNote.position;
                var gapTicks = currStart - prevEnd;
                
                // Large gap indicates phrase boundary (similar to phoneme gap detection)
                // Using 480 ticks (1 beat at 480 resolution) as threshold to better match actual DiffSinger output
                // This matches the typical gap between musical phrases
                bool isPhraseBoundary = gapTicks > 480 || i == lyricalNotes.Count - 1;
                
                if (isPhraseBoundary) {
                    int endIndex = (gapTicks > 480) ? i - 1 : i;
                    
                    if (endIndex >= startIndex) {
                        var phraseNotes = lyricalNotes.Skip(startIndex).Take(endIndex - startIndex + 1).ToList();
                        
                        phrases.Add(new SimulatedPhrase {
                            Number = phraseNumber,
                            Notes = phraseNotes,
                            StartTick = phraseNotes.First().position,
                            EndTick = phraseNotes.Last().position + phraseNotes.Last().duration
                        });
                        
                        phraseNumber++;
                        startIndex = i;
                    }
                }
            }
            
            return phrases;
        }
        
        private static void ShowRealDiffSingerPhrases(List<RenderPhrase> phrases) {
            Console.WriteLine($"🎤 REAL DIFFSINGER PHRASES ({phrases.Count} phrases):");
            Console.WriteLine("   (Generated by RenderPhrase.FromPart with actual phonemization)");
            
            for (int i = 0; i < Math.Min(phrases.Count, 15); i++) {
                var phrase = phrases[i];
                
                // Extract text exactly like DiffSingerScript does (line 33-37)
                var lyricalText = phrase.notes
                    .Where(n => !n.lyric.StartsWith("+"))
                    .Select(n => n.lyric)
                    .ToArray();
                
                var textWithSP = $"SP {string.Join(" ", lyricalText)} SP";
                
                // Show phoneme sequence
                var phonemeSeq = phrase.phones
                    .Select(p => p.phoneme)
                    .ToArray();
                
                // Show slur flags
                var slurFlags = phrase.notes
                    .Select(n => n.lyric.StartsWith("+") ? 1 : 0)
                    .ToArray();
                
                Console.WriteLine($"  Phrase {i + 1}:");
                Console.WriteLine($"    text: \"{textWithSP}\"");
                Console.WriteLine($"    lyrics: [{string.Join(", ", lyricalText)}] ({lyricalText.Length} words)");
                Console.WriteLine($"    phonemes: [{string.Join(", ", phonemeSeq.Take(10))}{(phonemeSeq.Length > 10 ? "..." : "")}] ({phonemeSeq.Length} total)");
                Console.WriteLine($"    slur_flags: [{string.Join(", ", slurFlags)}]");
                Console.WriteLine($"    timing: {phrase.positionMs:F0}ms - {phrase.endMs:F0}ms ({phrase.durationMs:F0}ms)");
                Console.WriteLine();
            }
            
            if (phrases.Count > 15) {
                Console.WriteLine($"  ... and {phrases.Count - 15} more phrases");
            }
            
            var totalWords = phrases.Sum(p => p.notes.Count(n => !n.lyric.StartsWith("+")));
            var avgWords = totalWords / (double)phrases.Count;
            
            Console.WriteLine("\n✅ SUCCESS - USING REAL OPENUTAU PHRASE DETECTION:");
            Console.WriteLine($"  1. Total phrases: {phrases.Count} (should be 24 for still_here.ustx)");
            Console.WriteLine($"  2. Total lyrical words: {totalWords}");
            Console.WriteLine($"  3. Average {avgWords:F1} words per phrase");
            Console.WriteLine("  4. Each RenderPhrase IS a complete verse unit");
            Console.WriteLine("  5. Your copilot should process these exact phrases");
        }
        
        private static void ShowSimulatedDiffSingerPhrases(List<SimulatedPhrase> phrases) {
            Console.WriteLine($"\n🎤 SIMULATED DIFFSINGER PHRASES ({phrases.Count} phrases):");
            Console.WriteLine("   (Fallback simulation - not using real phonemization)");
            
            for (int i = 0; i < Math.Min(phrases.Count, 10); i++) {
                var phrase = phrases[i];
                
                // Extract text exactly like DiffSingerScript does (line 33-37)
                var lyricalText = phrase.Notes.Select(n => n.lyric).ToArray();
                
                // Show what DiffSingerScript.text would contain
                var textWithSP = $"SP {string.Join(" ", lyricalText)} SP";
                
                // Convert timing to approximate milliseconds
                var startMs = phrase.StartTick * 60000.0 / (480 * 135); // Rough conversion
                var endMs = phrase.EndTick * 60000.0 / (480 * 135);
                
                Console.WriteLine($"  Phrase {i + 1}:");
                Console.WriteLine($"    text: \"{textWithSP}\"");
                Console.WriteLine($"    lyrics: [{string.Join(", ", lyricalText)}] ({lyricalText.Length} words)");
                Console.WriteLine($"    timing: {startMs:F0}ms - {endMs:F0}ms ({endMs - startMs:F0}ms)");
                Console.WriteLine($"    ticks: {phrase.StartTick} - {phrase.EndTick}");
                Console.WriteLine();
            }
            
            if (phrases.Count > 10) {
                Console.WriteLine($"  ... and {phrases.Count - 10} more phrases");
            }
            
            Console.WriteLine("\n✅ KEY POINTS FOR YOUR COPILOT:");
            Console.WriteLine("  1. DiffSingerScript processes ENTIRE phrases at once");
            Console.WriteLine("  2. Each phrase contains multiple words, not single words");
            Console.WriteLine($"  3. This song has {phrases.Count} logical phrases");
            Console.WriteLine("  4. Your template boundaries are mixing phonemes with lyrics");
            Console.WriteLine("  5. Fix: Update entire phrases, not arbitrary slices");
            
            var totalWords = phrases.Sum(p => p.Notes.Count);
            var avgWords = totalWords / (double)phrases.Count;
            Console.WriteLine($"  6. Average {avgWords:F1} words per phrase ({totalWords} total words)");
        }
        
        private class SimulatedPhrase {
            public int Number { get; set; }
            public List<UNote> Notes { get; set; } = new List<UNote>();
            public int StartTick { get; set; }
            public int EndTick { get; set; }
        }
        
        private static void ShowDiffSingerStylePhrases(List<RenderPhrase> phrases) {
            Console.WriteLine($"\n🎤 DIFFSINGER-STYLE PHRASES ({phrases.Count} phrases):");
            
            for (int i = 0; i < Math.Min(phrases.Count, 10); i++) {
                var phrase = phrases[i];
                
                // Extract text exactly like DiffSingerScript does (line 33-37)
                var lyricalText = phrase.notes
                    .Where(n => !n.lyric.StartsWith("+"))
                    .Select(n => n.lyric)
                    .ToArray();
                
                // Show phoneme sequence like DiffSingerScript does (line 38-42)
                var phonemeSeq = phrase.phones
                    .Select(p => p.phoneme)
                    .ToArray();
                
                // Show slur flags like DiffSingerScript does (line 48-52)
                var slurFlags = phrase.notes
                    .Select(n => n.lyric.StartsWith("+") ? 1 : 0)
                    .ToArray();
                
                var textWithSP = $"SP {string.Join(" ", lyricalText)} SP";
                
                Console.WriteLine($"  Phrase {i + 1}:");
                Console.WriteLine($"    text: \"{textWithSP}\"");
                Console.WriteLine($"    lyrics: [{string.Join(", ", lyricalText)}] ({lyricalText.Length} words)");
                Console.WriteLine($"    phonemes: [{string.Join(", ", phonemeSeq.Take(15))}{(phonemeSeq.Length > 15 ? "..." : "")}] ({phonemeSeq.Length} total)");
                Console.WriteLine($"    slur_flags: [{string.Join(", ", slurFlags)}]");
                Console.WriteLine($"    timing: {phrase.positionMs:F0}ms - {phrase.endMs:F0}ms ({phrase.durationMs:F0}ms)");
                Console.WriteLine();
            }
            
            if (phrases.Count > 10) {
                Console.WriteLine($"  ... and {phrases.Count - 10} more phrases");
            }
            
            Console.WriteLine("\n✅ HOW YOUR COPILOT SHOULD WORK:");
            Console.WriteLine("  1. Each RenderPhrase IS a complete verse/phrase unit");
            Console.WriteLine("  2. Extract lyrics like: phrase.notes.Where(n => !n.lyric.StartsWith(\"+\"))");
            Console.WriteLine("  3. Update entire phrases at once, not arbitrary boundary slices");
            Console.WriteLine("  4. Ignore template metadata - use OpenUtau's phrase detection");
            Console.WriteLine($"  5. Total of {phrases.Count} phrases detected in this song");
        }

        private static void ShowNoteSeparation(UProject project, UTrack track, UVoicePart part) {
            var allNotes = part.notes.OrderBy(n => n.position).ToList();
            var lyricalNotes = allNotes.Where(n => !string.IsNullOrEmpty(n.lyric) && !n.lyric.StartsWith("+")).ToList();
            var phonemeNotes = allNotes.Where(n => !string.IsNullOrEmpty(n.lyric) && n.lyric.StartsWith("+")).ToList();

            Console.WriteLine($"\n🎵 NOTE SEPARATION (OpenUtau C# Style):");
            Console.WriteLine($"   Total notes: {allNotes.Count}");
            Console.WriteLine($"   Lyrical notes: {lyricalNotes.Count}");
            Console.WriteLine($"   Phoneme notes: {phonemeNotes.Count}");
            Console.WriteLine($"   Phoneme ratio: {(double)phonemeNotes.Count / allNotes.Count * 100:F1}%");

            Console.WriteLine($"\n   First 20 notes (Mixed Stream - What Your Copilot Sees):");
            foreach (var (note, index) in allNotes.Take(20).Select((n, i) => (n, i))) {
                var noteType = note.lyric.StartsWith("+") ? "PHONEME" : "LYRICAL";
                var slurFlag = note.lyric.StartsWith("+") ? 1 : 0;
                Console.WriteLine($"     {index:2}: \"{note.lyric,-10}\" [{noteType,-8}] slur={slurFlag}");
            }

            Console.WriteLine($"\n   Lyrical Notes Only (OpenUtau C# Stream):");
            foreach (var (note, index) in lyricalNotes.Take(20).Select((n, i) => (n, i))) {
                Console.WriteLine($"     {index:2}: \"{note.lyric}\"");
            }
            
            // Show OpenUtau's actual verse detection via RenderPhrases
            ShowActualRenderPhraseMethod(project, track, part);
        }
        
        private static void ShowActualRenderPhraseMethod(UProject project, UTrack track, UVoicePart part) {
            Console.WriteLine($"\n📖 OPENUTAU'S ACTUAL METHOD (RenderPhrase + DiffSingerScript):");
            
            try {
                // Use OpenUtau's ACTUAL phrase detection method
                var renderPhrases = RenderPhrase.FromPart(project, track, part).ToList();
                
                Console.WriteLine($"   OpenUtau detected {renderPhrases.Count} render phrases:");
                
                int phraseNumber = 1;
                foreach (var phrase in renderPhrases.Take(15)) {
                    // Extract lyrical text exactly like DiffSingerScript does
                    var lyricalText = phrase.notes
                        .Where(n => !n.lyric.StartsWith("+"))
                        .Select(n => n.lyric)
                        .ToArray();
                    
                    // Show phoneme info like DiffSingerScript
                    var phonemeSeq = phrase.phones
                        .Select(p => p.phoneme)
                        .ToArray();
                    
                    // Show slur flags like DiffSingerScript
                    var slurFlags = phrase.notes
                        .Select(n => n.lyric.StartsWith("+") ? 1 : 0)
                        .ToArray();
                    
                    var lyricsString = string.Join(" ", lyricalText);
                    Console.WriteLine($"     Phrase {phraseNumber}: ({lyricalText.Length} lyrical words, {phrase.phones.Length} phonemes)");
                    Console.WriteLine($"       Lyrical text: \"{lyricsString}\"");
                    Console.WriteLine($"       Phonemes: [{string.Join(", ", phonemeSeq.Take(10))}{(phonemeSeq.Length > 10 ? "..." : "")}]");
                    Console.WriteLine($"       Slur flags: [{string.Join(", ", slurFlags.Take(10))}{(slurFlags.Length > 10 ? "..." : "")}]");
                    Console.WriteLine($"       Timing: {phrase.positionMs:F0}ms - {phrase.endMs:F0}ms ({phrase.durationMs:F0}ms)");
                    Console.WriteLine();
                    
                    phraseNumber++;
                }
                
                if (renderPhrases.Count > 15) {
                    Console.WriteLine($"     ... and {renderPhrases.Count - 15} more phrases");
                }
                
                Console.WriteLine("\n🔧 HOW YOUR COPILOT SHOULD WORK:");
                Console.WriteLine("   1. Use RenderPhrase.FromPart() to get actual musical phrases");
                Console.WriteLine("   2. Each RenderPhrase IS a verse/phrase unit");
                Console.WriteLine("   3. Extract lyrical text like DiffSingerScript: notes.Where(n => !n.lyric.StartsWith(\"+\"))");
                Console.WriteLine("   4. Update entire phrases at once, not arbitrary boundary slices");
                Console.WriteLine("   5. Ignore template metadata - use OpenUtau's real phrase detection");
                
            } catch (Exception e) {
                Console.WriteLine($"   ⚠️ Cannot create render phrases without singer setup: {e.Message}");
                Console.WriteLine("   This would work in full OpenUtau with proper phonemizer setup.");
            }
        }
        
        private static List<OpenUtauVerse> DetectVersesOpenUtauStyle(List<UNote> lyricalNotes) {
            var verses = new List<OpenUtauVerse>();
            if (!lyricalNotes.Any()) return verses;
            
            int verseNumber = 1;
            int startIndex = 0;
            
            // OpenUtau uses phoneme gaps to detect phrase boundaries (RenderPhrase.FromPart logic)
            // We simulate this by detecting large timing gaps in notes
            for (int i = 1; i < lyricalNotes.Count; i++) {
                var prevNote = lyricalNotes[i - 1];
                var currNote = lyricalNotes[i];
                
                // Calculate gap between note ends and starts
                var prevEnd = prevNote.position + prevNote.duration;
                var currStart = currNote.position;
                var gapTicks = currStart - prevEnd;
                
                // Convert to milliseconds for readability
                var gapMs = gapTicks * 60000.0 / (480 * 135); // Rough conversion for 135 BPM, 480 resolution
                
                // OpenUtau creates phrase breaks when phonemes don't connect
                // We detect this as gaps > 240 ticks (about 500ms at 135 BPM)
                bool isPhraseBoundary = gapTicks > 240 || i == lyricalNotes.Count - 1;
                
                if (isPhraseBoundary) {
                    int endIndex = (gapTicks > 240) ? i - 1 : i;
                    
                    if (endIndex >= startIndex) {
                        var verseNotes = lyricalNotes.Skip(startIndex).Take(endIndex - startIndex + 1).ToList();
                        
                        verses.Add(new OpenUtauVerse {
                            Number = verseNumber,
                            LyricalStartIndex = startIndex,
                            LyricalEndIndex = endIndex,
                            Notes = verseNotes,
                            WordCount = verseNotes.Count,
                            GapAfterMs = gapMs
                        });
                        
                        verseNumber++;
                        startIndex = i;
                    }
                }
            }
            
            return verses;
        }
        
        private class OpenUtauVerse {
            public int Number { get; set; }
            public int LyricalStartIndex { get; set; }
            public int LyricalEndIndex { get; set; }
            public List<UNote> Notes { get; set; } = new List<UNote>();
            public int WordCount { get; set; }
            public double GapAfterMs { get; set; }
        }

        private static void ShowRenderPhrases(List<RenderPhrase> phrases) {
            Console.WriteLine($"\n🎤 RENDER PHRASES ({phrases.Count} phrases):");
            
            foreach (var (phrase, index) in phrases.Select((p, i) => (p, i))) {
                // Get lyrical text (equivalent to DiffSingerScript.text)
                var lyricalText = phrase.notes
                    .Where(n => !n.lyric.StartsWith("+"))
                    .Select(n => n.lyric)
                    .ToArray();

                // Get phoneme sequence (equivalent to DiffSingerScript.ph_seq)
                var phonemeSeq = phrase.phones
                    .Select(p => p.phoneme)
                    .ToArray();

                // Get slur flags (equivalent to DiffSingerScript.note_slur)
                var slurFlags = phrase.notes
                    .Select(n => n.lyric.StartsWith("+") ? 1 : 0)
                    .ToArray();

                Console.WriteLine($"   Phrase {index + 1}:");
                Console.WriteLine($"     Position: {phrase.positionMs:F0}ms - {phrase.endMs:F0}ms");
                Console.WriteLine($"     Lyrical text: \"{string.Join(" ", lyricalText)}\"");
                Console.WriteLine($"     Phonemes: [{string.Join(", ", phonemeSeq)}]");
                Console.WriteLine($"     Slur flags: [{string.Join(", ", slurFlags)}]");
                Console.WriteLine($"     Notes: {phrase.notes.Length}, Phones: {phrase.phones.Length}");
                Console.WriteLine();
            }
        }

        private static void ShowDiffSingerProcessing(List<RenderPhrase> phrases) {
            Console.WriteLine($"\n🤖 DIFFSINGER PROCESSING:");
            
            foreach (var (phrase, index) in phrases.Select((p, i) => (p, i))) {
                try {
                    // Create DiffSinger script using OpenUtau's actual implementation
                    var dsScript = new DiffSingerScript(phrase);

                    Console.WriteLine($"   Phrase {index + 1} DiffSinger Script:");
                    Console.WriteLine($"     text: [{string.Join(", ", dsScript.text)}]");
                    Console.WriteLine($"     ph_seq: [{string.Join(", ", dsScript.ph_seq)}]");
                    Console.WriteLine($"     ph_num: [{string.Join(", ", dsScript.ph_num)}]");
                    Console.WriteLine($"     note_slur: [{string.Join(", ", dsScript.note_slur)}]");
                    Console.WriteLine($"     Offset: {dsScript.offsetMs:F2}ms");
                    Console.WriteLine();

                } catch (Exception e) {
                    Console.WriteLine($"     ⚠️ DiffSinger processing failed: {e.Message}");
                }
            }
        }

        private static void ShowManualVerseDetection(UProject project, UVoicePart part) {
            Console.WriteLine($"\n📖 MANUAL VERSE DETECTION:");

            var lyricalNotes = part.notes
                .Where(n => !string.IsNullOrEmpty(n.lyric) && !n.lyric.StartsWith("+"))
                .OrderBy(n => n.position)
                .ToList();

            var verses = DetectVersesManually(project, lyricalNotes);

            Console.WriteLine($"   Detected {verses.Count} verses:");
            foreach (var verse in verses.Take(10)) {
                Console.WriteLine($"     Verse {verse.Number}: [{verse.StartIndex:2}-{verse.EndIndex:2}] ({verse.WordCount:2} words)");
                Console.WriteLine($"       \"{verse.Lyrics}\"");
                Console.WriteLine();
            }
        }

        private static List<VerseInfo> DetectVersesManually(UProject project, List<UNote> lyricalNotes) {
            var verses = new List<VerseInfo>();
            int verseNumber = 1;
            int startIndex = 0;

            for (int i = 1; i < lyricalNotes.Count; i++) {
                var prevNote = lyricalNotes[i - 1];
                var currNote = lyricalNotes[i];

                // Calculate gap in ticks
                var gap = currNote.position - (prevNote.position + prevNote.duration);

                // Large gap indicates verse boundary
                if (gap > 1000 || i == lyricalNotes.Count - 1) {
                    int endIndex = gap > 1000 ? i - 1 : i;
                    
                    if (endIndex >= startIndex) {
                        var verseLyrics = lyricalNotes
                            .Skip(startIndex)
                            .Take(endIndex - startIndex + 1)
                            .Select(n => n.lyric)
                            .ToList();

                        verses.Add(new VerseInfo {
                            Number = verseNumber,
                            StartIndex = startIndex,
                            EndIndex = endIndex,
                            Lyrics = string.Join(" ", verseLyrics),
                            WordCount = verseLyrics.Count
                        });

                        verseNumber++;
                        startIndex = i;
                    }
                }
            }

            return verses;
        }

        private class VerseInfo {
            public int Number { get; set; }
            public int StartIndex { get; set; }
            public int EndIndex { get; set; }
            public string Lyrics { get; set; } = "";
            public int WordCount { get; set; }
        }
    }
}