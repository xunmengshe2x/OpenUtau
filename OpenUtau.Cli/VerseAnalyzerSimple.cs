using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using OpenUtau.Api;
using OpenUtau.Classic;
using OpenUtau.Core;
using OpenUtau.Core.DiffSinger;
using OpenUtau.Core.Format;
using OpenUtau.Core.Render;
using OpenUtau.Core.Ustx;
using OpenUtau.Core.Util;

namespace OpenUtau.Cli {
    public class VerseAnalyzerSimple {
        public static void AnalyzeVerses(string ustxPath) {
            Console.WriteLine("============================================================");
            Console.WriteLine("OpenUtau Verse Analysis - DiffSinger/RenderPhrase Method");
            Console.WriteLine("============================================================");

            try {
                // 1. Initialize exactly like the working CLI
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                
                var inputDir = Path.GetDirectoryName(Path.GetFullPath(ustxPath));
                var localSingerPath = Path.Combine(inputDir ?? string.Empty, "fem_1_ln");
                if (Directory.Exists(localSingerPath)) {
                    Preferences.Default.AdditionalSingerPath = localSingerPath;
                    Preferences.Default.InstallToAdditionalSingersPath = true;
                }
                
                SingerManager.Inst.Initialize();
                ToolsManager.Inst.Initialize();
                DocManager.Inst.SearchAllPlugins();
                DocManager.Inst.SearchAllLegacyPlugins();
                DocManager.Inst.Initialize(System.Threading.Thread.CurrentThread, System.Threading.Tasks.TaskScheduler.Current);
                
                // 2. Load the USTX project
                var project = Ustx.Load(ustxPath);
                Console.WriteLine($"✅ Loaded: {project.name}");
                Console.WriteLine($"   Parts: {project.parts.Count}");
                
                // 3. Get the singer (fem_1_ln)
                var singer = SingerManager.Inst.GetSinger("fem_1_ln");
                if (singer == null) {
                    // Try loading from local directory
                    var voicebankDir = Path.Combine(inputDir ?? string.Empty, "fem_1_ln");
                    if (Directory.Exists(voicebankDir)) {
                        var loader = new VoicebankLoader(voicebankDir);
                        var banks = loader.SearchAll().ToList();
                        if (banks.Count > 0) {
                            singer = ClassicSingerLoader.AdjustSingerType(banks[0]);
                        }
                    }
                }
                
                if (singer == null) {
                    Console.WriteLine("❌ Singer fem_1_ln not found");
                    return;
                }
                
                Console.WriteLine($"✅ Singer: {singer.Name} (Type: {singer.SingerType})");
                
                // 4. Process each voice part (exactly like CLI)
                foreach (var part in project.parts.OfType<UVoicePart>()) {
                    var track = project.tracks[part.trackNo];
                    track.Singer = singer;
                    
                    // Get phonemizer
                    var phonemizer = track.Phonemizer;
                    Console.WriteLine($"✅ Phonemizer: {phonemizer.GetType().Name}");
                    
                    phonemizer.SetSinger(singer);
                    phonemizer.SetTiming(project.timeAxis);
                    
                    // Group notes for phonemizer (exactly like CLI lines 330-350)
                    var notes = part.notes.ToList();
                    var groups = new List<Phonemizer.Note[]>();
                    var groupToNote = new List<UNote>();
                    
                    for (int idx = 0; idx < notes.Count; idx++) {
                        var note = notes[idx];
                        if (note.OverlapError || note.Extends != null) {
                            continue;
                        }
                        var groupNotes = new List<UNote> { note };
                        var next = note.Next;
                        while (next != null && next.Extends == note) {
                            groupNotes.Add(next);
                            next = next.Next;
                        }
                        groups.Add(groupNotes.Select(n => n.ToPhonemizerNote(track, part)).ToArray());
                        groupToNote.Add(note);
                    }
                    
                    Console.WriteLine($"   Processing {groups.Count} note groups...");
                    
                    // Initialize phonemizer
                    phonemizer.SetUp(groups.ToArray(), project, track);
                    
                    // Process phonemes (exactly like CLI)
                    var phonemeResults = new List<Phonemizer.Phoneme[]>();
                    for (int i = groups.Count - 1; i >= 0; i--) {
                        var grp = groups[i];
                        Phonemizer.Note? prev = null, next = null;
                        Phonemizer.Note[] prevs = Array.Empty<Phonemizer.Note>();
                        bool prevIsNeighbour = false, nextIsNeighbour = false;
                        
                        if (i > 0) {
                            prevs = groups[i - 1];
                            prev = prevs.FirstOrDefault();
                            var prevLast = prevs.Last();
                            prevIsNeighbour = prevLast.position + prevLast.duration >= grp[0].position;
                        }
                        if (i < groups.Count - 1) {
                            next = groups[i + 1].FirstOrDefault();
                            var thisLast = grp.Last();
                            if (next != null) {
                                nextIsNeighbour = thisLast.position + thisLast.duration >= next.Value.position;
                            }
                        }
                        
                        var res = phonemizer.Process(
                            grp, prev, next,
                            prevIsNeighbour ? prev : null,
                            nextIsNeighbour ? next : null,
                            prevIsNeighbour ? prevs : Array.Empty<Phonemizer.Note>()
                        );
                        
                        // Convert positions
                        for (int j = 0; j < res.phonemes.Length; j++) {
                            res.phonemes[j].position += grp[0].position;
                        }
                        
                        phonemeResults.Insert(0, res.phonemes);
                    }
                    
                    // Inject phonemes into part (exactly like CLI)
                    part.phonemes.Clear();
                    for (int gi = 0; gi < phonemeResults.Count; gi++) {
                        var group = phonemeResults[gi];
                        var parentNote = gi < groupToNote.Count ? groupToNote[gi] : null;
                        foreach (var ph in group) {
                            var up = new UPhoneme() {
                                rawPosition = ph.position - part.position,
                                rawPhoneme = ph.phoneme,
                                index = ph.index ?? 0,
                                Parent = parentNote
                            };
                            part.phonemes.Add(up);
                        }
                    }
                    
                    // Apply phoneme processing
                    foreach (var phoneme in part.phonemes) {
                        phoneme.position = phoneme.rawPosition;
                        phoneme.phoneme = phoneme.rawPhoneme;
                        phoneme.preutterDelta = null;
                        phoneme.overlapDelta = null;
                    }
                    
                    Console.WriteLine($"   Generated {part.phonemes.Count} phonemes");
                    
                    // Validate part
                    var validateOptions = new ValidateOptions {
                        SkipTiming = false,
                        Part = part,
                        SkipPhonemizer = true,
                        SkipPhoneme = false
                    };
                    part.Validate(validateOptions, project, track);
                    
                    // NOW GENERATE RENDER PHRASES (exactly like CLI line 580)
                    track.RendererSettings.Validate(track);
                    var renderPhrases = RenderPhrase.FromPart(project, track, part).ToList();
                    
                    Console.WriteLine($"\n🎤 GENERATED {renderPhrases.Count} RENDER PHRASES:");
                    Console.WriteLine("============================================================");
                    
                    // Show each phrase (like DiffSingerScript processes them)
                    for (int i = 0; i < renderPhrases.Count; i++) {
                        var phrase = renderPhrases[i];
                        
                        // Extract lyrics exactly like DiffSingerScript.cs line 33-37
                        var lyricalText = phrase.notes
                            .Where(n => !n.lyric.StartsWith("+"))
                            .Select(n => n.lyric)
                            .ToArray();
                        
                        var textWithSP = $"SP {string.Join(" ", lyricalText)} SP";
                        
                        Console.WriteLine($"Phrase {i + 1}:");
                        Console.WriteLine($"  text: \"{textWithSP}\"");
                        Console.WriteLine($"  words: {lyricalText.Length}");
                        Console.WriteLine($"  timing: {phrase.positionMs:F0}ms - {phrase.endMs:F0}ms");
                        
                        if (Environment.GetEnvironmentVariable("OPENUTAU_OUTPUT_JSON") != "true" && i >= 10 && renderPhrases.Count > 15) {
                            Console.WriteLine($"\n... and {renderPhrases.Count - 11} more phrases");
                            break;
                        }
                    }
                    
                    Console.WriteLine("\n============================================================");
                    Console.WriteLine("✅ SUCCESS!");
                    Console.WriteLine($"This song has {renderPhrases.Count} phrases (should be 24 for still_here.ustx)");
                    
                    var totalWords = renderPhrases.Sum(p => p.notes.Count(n => !n.lyric.StartsWith("+")));
                    Console.WriteLine($"Total lyrical words: {totalWords}");
                    Console.WriteLine($"Average words per phrase: {totalWords / (double)renderPhrases.Count:F1}");
                    
                    // Check if JSON output is requested
                    if (Environment.GetEnvironmentVariable("OPENUTAU_OUTPUT_JSON") == "true") {
                        OutputPhrasesAsJson(renderPhrases);
                        // Also save phrase boundaries for robust editing
                        SavePhraseBoundaries(renderPhrases, ustxPath);
                        return; // Skip interactive mode
                    }
                    
                    // Interactive mode for editing lyrics
                    Console.WriteLine("\n============================================================");
                    Console.WriteLine("INTERACTIVE MODE - Edit phrase lyrics");
                    Console.WriteLine("Enter phrase number (1-{0}) to edit, or 'q' to quit:", renderPhrases.Count);
                    
                    while (true) {
                        Console.Write("> ");
                        var input = Console.ReadLine();
                        
                        if (string.IsNullOrEmpty(input) || input.ToLower() == "q") {
                            break;
                        }
                        
                        if (int.TryParse(input, out int phraseNum) && phraseNum >= 1 && phraseNum <= renderPhrases.Count) {
                            var phraseIndex = phraseNum - 1;
                            var phrase = renderPhrases[phraseIndex];
                            
                            // Show current lyrics
                            var currentLyrics = phrase.notes
                                .Where(n => !n.lyric.StartsWith("+"))
                                .Select(n => n.lyric)
                                .ToArray();
                            
                            Console.WriteLine($"\nPhrase {phraseNum} current lyrics:");
                            Console.WriteLine($"  \"{string.Join(" ", currentLyrics)}\"");
                            Console.WriteLine($"\nEnter new lyrics (space-separated words, same count: {currentLyrics.Length} words):");
                            Console.Write("> ");
                            
                            var newLyricsInput = Console.ReadLine();
                            if (!string.IsNullOrEmpty(newLyricsInput)) {
                                var newLyrics = newLyricsInput.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                                
                                if (newLyrics.Length != currentLyrics.Length) {
                                    Console.WriteLine($"❌ Error: Expected {currentLyrics.Length} words, got {newLyrics.Length}");
                                    continue;
                                }
                                
                                // Update the lyrics in the original part
                                var lyricalNotes = part.notes
                                    .Where(n => !string.IsNullOrEmpty(n.lyric) && !n.lyric.StartsWith("+"))
                                    .ToList();
                                
                                // Find which notes correspond to this phrase
                                var phraseStartPos = phrase.notes[0].position;
                                var phraseEndPos = phrase.notes[phrase.notes.Length - 1].position + phrase.notes[phrase.notes.Length - 1].duration;
                                
                                var notesToUpdate = lyricalNotes
                                    .Where(n => n.position >= phraseStartPos - 100 && n.position <= phraseEndPos + 100)
                                    .Take(newLyrics.Length)
                                    .ToList();
                                
                                if (notesToUpdate.Count == newLyrics.Length) {
                                    for (int i = 0; i < newLyrics.Length; i++) {
                                        notesToUpdate[i].lyric = newLyrics[i];
                                        Console.WriteLine($"  Updated: \"{currentLyrics[i]}\" -> \"{newLyrics[i]}\"");
                                    }
                                    
                                    Console.WriteLine("\n🔄 Re-running phonemization with new lyrics...");
                                    
                                    // Clear old phonemes
                                    part.phonemes.Clear();
                                    
                                    // Clean up old phonemizer and get a fresh one
                                    phonemizer.CleanUp();
                                    
                                    // Get a fresh phonemizer instance
                                    phonemizer = track.Phonemizer;
                                    phonemizer.SetSinger(singer);
                                    phonemizer.SetTiming(project.timeAxis);
                                    
                                    // Re-run phonemization (same as before)
                                    var notes2 = part.notes.ToList();
                                    var groups2 = new List<Phonemizer.Note[]>();
                                    var groupToNote2 = new List<UNote>();
                                    
                                    for (int idx = 0; idx < notes2.Count; idx++) {
                                        var note = notes2[idx];
                                        if (note.OverlapError || note.Extends != null) {
                                            continue;
                                        }
                                        var groupNotes = new List<UNote> { note };
                                        var next = note.Next;
                                        while (next != null && next.Extends == note) {
                                            groupNotes.Add(next);
                                            next = next.Next;
                                        }
                                        groups2.Add(groupNotes.Select(n => n.ToPhonemizerNote(track, part)).ToArray());
                                        groupToNote2.Add(note);
                                    }
                                    
                                    phonemizer.SetUp(groups2.ToArray(), project, track);
                                    
                                    var phonemeResults2 = new List<Phonemizer.Phoneme[]>();
                                    for (int i = groups2.Count - 1; i >= 0; i--) {
                                        var grp = groups2[i];
                                        Phonemizer.Note? prev = null, next = null;
                                        Phonemizer.Note[] prevs = Array.Empty<Phonemizer.Note>();
                                        bool prevIsNeighbour = false, nextIsNeighbour = false;
                                        
                                        if (i > 0) {
                                            prevs = groups2[i - 1];
                                            prev = prevs.FirstOrDefault();
                                            var prevLast = prevs.Last();
                                            prevIsNeighbour = prevLast.position + prevLast.duration >= grp[0].position;
                                        }
                                        if (i < groups2.Count - 1) {
                                            next = groups2[i + 1].FirstOrDefault();
                                            var thisLast = grp.Last();
                                            if (next != null) {
                                                nextIsNeighbour = thisLast.position + thisLast.duration >= next.Value.position;
                                            }
                                        }
                                        
                                        var res = phonemizer.Process(
                                            grp, prev, next,
                                            prevIsNeighbour ? prev : null,
                                            nextIsNeighbour ? next : null,
                                            prevIsNeighbour ? prevs : Array.Empty<Phonemizer.Note>()
                                        );
                                        
                                        for (int j = 0; j < res.phonemes.Length; j++) {
                                            res.phonemes[j].position += grp[0].position;
                                        }
                                        
                                        phonemeResults2.Insert(0, res.phonemes);
                                    }
                                    
                                    for (int gi = 0; gi < phonemeResults2.Count; gi++) {
                                        var group = phonemeResults2[gi];
                                        var parentNote = gi < groupToNote2.Count ? groupToNote2[gi] : null;
                                        foreach (var ph in group) {
                                            var up = new UPhoneme() {
                                                rawPosition = ph.position - part.position,
                                                rawPhoneme = ph.phoneme,
                                                index = ph.index ?? 0,
                                                Parent = parentNote
                                            };
                                            part.phonemes.Add(up);
                                        }
                                    }
                                    
                                    foreach (var phoneme in part.phonemes) {
                                        phoneme.position = phoneme.rawPosition;
                                        phoneme.phoneme = phoneme.rawPhoneme;
                                        phoneme.preutterDelta = null;
                                        phoneme.overlapDelta = null;
                                    }
                                    
                                    part.Validate(validateOptions, project, track);
                                    
                                    // Don't re-generate phrases - just show the updated lyrics
                                    Console.WriteLine($"✅ Updated lyrics (phonemes regenerated)");
                                    
                                    // Show what was updated without changing phrase structure
                                    Console.WriteLine($"\nPhrase {phraseNum} updated:");
                                    Console.WriteLine($"  text: \"SP {string.Join(" ", newLyrics)} SP\"");
                                    Console.WriteLine($"  Note: Phrase boundaries preserved - still {renderPhrases.Count} phrases");
                                    
                                    // Optionally save the updated USTX
                                    Console.WriteLine("\nSave changes to file? (y/n):");
                                    Console.Write("> ");
                                    var saveInput = Console.ReadLine();
                                    if (saveInput?.ToLower() == "y") {
                                        var outputPath = ustxPath.Replace(".ustx", "_edited.ustx");
                                        
                                        // Don't clear phonemes - keep them to preserve timing
                                        // The phonemes won't match the lyrics perfectly but will preserve phrase structure
                                        
                                        Ustx.Save(outputPath, project);
                                        Console.WriteLine($"✅ Saved to: {outputPath}");
                                        Console.WriteLine("⚠️ Note: Phonemes kept to preserve phrase boundaries.");
                                        Console.WriteLine("   For proper synthesis, load in OpenUtau and regenerate phonemes there.");
                                    }
                                } else {
                                    Console.WriteLine("❌ Error: Could not match notes to phrase");
                                }
                            }
                        } else {
                            Console.WriteLine($"Invalid phrase number. Enter 1-{renderPhrases.Count}");
                        }
                        
                        Console.WriteLine("\nEnter phrase number (1-{0}) to edit, or 'q' to quit:", renderPhrases.Count);
                    }
                    
                    phonemizer.CleanUp();
                    break; // Only process first part
                }
                
            } catch (Exception e) {
                Console.WriteLine($"❌ Error: {e.Message}");
                Console.WriteLine($"Stack: {e.StackTrace}");
            }
        }
        
        public static void EditPhrase(string ustxPath, int phraseNumber, string newLyrics) {
            try {
                Console.WriteLine($"🎵 Editing phrase {phraseNumber} in {ustxPath}");
                Console.WriteLine($"📝 New lyrics: \"{newLyrics}\"");
                
                // Initialize systems like AnalyzeVerses
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                
                var inputDir = Path.GetDirectoryName(Path.GetFullPath(ustxPath));
                var localSingerPath = Path.Combine(inputDir ?? string.Empty, "fem_1_ln");
                if (Directory.Exists(localSingerPath)) {
                    Preferences.Default.AdditionalSingerPath = localSingerPath;
                    Preferences.Default.InstallToAdditionalSingersPath = true;
                }
                
                SingerManager.Inst.Initialize();
                ToolsManager.Inst.Initialize();
                DocManager.Inst.SearchAllPlugins();
                DocManager.Inst.SearchAllLegacyPlugins();
                DocManager.Inst.Initialize(System.Threading.Thread.CurrentThread, System.Threading.Tasks.TaskScheduler.Current);
                
                // Load project
                var project = Ustx.Load(ustxPath);
                if (project?.parts.FirstOrDefault() is not UVoicePart part) {
                    Console.WriteLine("❌ Could not load voice part");
                    return;
                }
                
                // Get singer and set up like AnalyzeVerses
                var singer = SingerManager.Inst.GetSinger("fem_1_ln");
                if (singer == null) {
                    var voicebankDir = Path.Combine(inputDir ?? string.Empty, "fem_1_ln");
                    if (Directory.Exists(voicebankDir)) {
                        var loader = new VoicebankLoader(voicebankDir);
                        var banks = loader.SearchAll().ToList();
                        if (banks.Count > 0) {
                            singer = ClassicSingerLoader.AdjustSingerType(banks[0]);
                        }
                    }
                }
                
                if (singer == null) {
                    Console.WriteLine("❌ Singer fem_1_ln not found");
                    return;
                }
                
                var track = project.tracks[part.trackNo];
                track.Singer = singer;
                
                // Load phrase boundaries from saved JSON (avoiding phonemizer re-run)
                var boundariesPath = ustxPath.Replace(".ustx", ".boundaries.json");
                var phraseBoundaries = LoadPhraseBoundaries(boundariesPath);
                
                if (phraseBoundaries == null) {
                    Console.WriteLine($"❌ No phrase boundaries found. Please run: OPENUTAU_OUTPUT_JSON=true dotnet run --project OpenUtau.Cli -- analyze-verses {Path.GetFileName(ustxPath)}");
                    return;
                }
                
                if (phraseNumber < 1 || phraseNumber > phraseBoundaries.Length) {
                    Console.WriteLine($"❌ Phrase {phraseNumber} not found. Available: 1-{phraseBoundaries.Length}");
                    return;
                }
                
                var boundary = phraseBoundaries[phraseNumber - 1];
                var newWords = newLyrics.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                
                // Convert ms to ticks using the project's time axis (the correct way!)
                var startTicks = project.timeAxis.MsPosToTickPos(boundary.StartMs);
                var endTicks = project.timeAxis.MsPosToTickPos(boundary.EndMs);
                
                // Find notes in this phrase by timing
                var phraseNotes = part.notes
                    .Where(n => n.position >= startTicks && n.position < endTicks)
                    .Where(n => !n.lyric.StartsWith("+"))
                    .ToArray();
                
                Console.WriteLine($"📊 Phrase has {phraseNotes.Length} notes, new lyrics has {newWords.Length} words");
                
                // Update lyrics
                for (int i = 0; i < Math.Min(phraseNotes.Length, newWords.Length); i++) {
                    phraseNotes[i].lyric = newWords[i];
                }
                
                if (newWords.Length < phraseNotes.Length) {
                    for (int i = newWords.Length; i < phraseNotes.Length; i++) {
                        phraseNotes[i].lyric = newWords[^1];
                    }
                }
                
                // Save edited file
                var timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds();
                var editedPath = ustxPath.Replace(".ustx", $"_edited_{timestamp}.ustx");
                
                Ustx.Save(editedPath, project);
                Console.WriteLine($"✅ Saved edited file → {editedPath}");
                
                // Output updated verses if JSON output requested (avoid re-running phonemizer)
                if (Environment.GetEnvironmentVariable("OPENUTAU_OUTPUT_JSON") == "true") {
                    Console.WriteLine("🔄 Outputting updated verses after edit...");
                    
                    // Re-read the phrase boundaries to get all phrases
                    var allBoundaries = LoadPhraseBoundaries(boundariesPath);
                    if (allBoundaries != null) {
                        var verses = new List<object>();
                        
                        for (int i = 0; i < allBoundaries.Length; i++) {
                            var phraseBoundary = allBoundaries[i];
                            var phraseStartTicks = project.timeAxis.MsPosToTickPos(phraseBoundary.StartMs);
                            var phraseEndTicks = project.timeAxis.MsPosToTickPos(phraseBoundary.EndMs);
                            
                            // Get the current lyrics for this phrase from the edited project
                            var phraseLyricsNotes = part.notes
                                .Where(n => n.position >= phraseStartTicks && n.position < phraseEndTicks)
                                .Where(n => !n.lyric.StartsWith("+"))
                                .ToArray();
                            
                            var lyrics = phraseLyricsNotes.Select(n => n.lyric).ToArray();
                            var lyricsText = string.Join(" ", lyrics);
                            
                            verses.Add(new {
                                index = i + 1,
                                lyrics = lyricsText,
                                wordCount = lyrics.Length,
                                startMs = phraseBoundary.StartMs,
                                endMs = phraseBoundary.EndMs
                            });
                        }
                        
                        var jsonOutput = JsonSerializer.Serialize(new { verses = verses }, new JsonSerializerOptions { WriteIndented = true });
                        Console.WriteLine(jsonOutput);
                        Console.WriteLine($"✅ Output {verses.Count} verses after edit");
                    }
                }
                
            } catch (Exception ex) {
                Console.WriteLine($"❌ Edit failed: {ex.Message}");
            }
        }
        
        public static void BatchEditPhrases(string ustxPath, string batchEditString) {
            try {
                Console.WriteLine($"🎵 Batch editing phrases in {ustxPath}");
                
                // Parse batch edit string
                var edits = new Dictionary<int, string>();
                foreach (var edit in batchEditString.Split(';')) {
                    var parts = edit.Split(':', 2);
                    if (parts.Length == 2 && int.TryParse(parts[0], out int phraseNum)) {
                        edits[phraseNum] = parts[1];
                    }
                }
                
                Console.WriteLine($"📝 Parsed {edits.Count} edit commands");
                
                // Initialize and load like EditPhrase
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                
                var inputDir = Path.GetDirectoryName(Path.GetFullPath(ustxPath));
                var localSingerPath = Path.Combine(inputDir ?? string.Empty, "fem_1_ln");
                if (Directory.Exists(localSingerPath)) {
                    Preferences.Default.AdditionalSingerPath = localSingerPath;
                    Preferences.Default.InstallToAdditionalSingersPath = true;
                }
                
                SingerManager.Inst.Initialize();
                ToolsManager.Inst.Initialize();
                DocManager.Inst.SearchAllPlugins();
                DocManager.Inst.SearchAllLegacyPlugins();
                DocManager.Inst.Initialize(System.Threading.Thread.CurrentThread, System.Threading.Tasks.TaskScheduler.Current);
                
                var project = Ustx.Load(ustxPath);
                if (project?.parts.FirstOrDefault() is not UVoicePart part) {
                    Console.WriteLine("❌ Could not load voice part");
                    return;
                }
                
                var singer = SingerManager.Inst.GetSinger("fem_1_ln");
                if (singer == null) {
                    var voicebankDir = Path.Combine(inputDir ?? string.Empty, "fem_1_ln");
                    if (Directory.Exists(voicebankDir)) {
                        var loader = new VoicebankLoader(voicebankDir);
                        var banks = loader.SearchAll().ToList();
                        if (banks.Count > 0) {
                            singer = ClassicSingerLoader.AdjustSingerType(banks[0]);
                        }
                    }
                }
                
                if (singer == null) {
                    Console.WriteLine("❌ Singer fem_1_ln not found");
                    return;
                }
                
                var track = project.tracks[part.trackNo];
                track.Singer = singer;
                
                var renderPhrases = GetRenderPhrases(project, part, track, singer);
                
                // Apply each edit
                foreach (var edit in edits) {
                    var phraseNumber = edit.Key;
                    var newLyrics = edit.Value;
                    
                    if (phraseNumber < 1 || phraseNumber > renderPhrases.Count) {
                        Console.WriteLine($"⚠️ Skipping phrase {phraseNumber} - not found");
                        continue;
                    }
                    
                    Console.WriteLine($"✏️ Editing phrase {phraseNumber}: \"{newLyrics}\"");
                    
                    var targetPhrase = renderPhrases[phraseNumber - 1];
                    var newWords = newLyrics.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    
                    var phraseStartTicks = project.timeAxis.MsPosToTickPos(targetPhrase.positionMs);
                    var phraseEndTicks = project.timeAxis.MsPosToTickPos(targetPhrase.endMs);
                    
                    var phraseNotes = part.notes
                        .Where(n => n.position >= phraseStartTicks && n.position < phraseEndTicks)
                        .Where(n => !n.lyric.StartsWith("+"))
                        .ToArray();
                    
                    for (int i = 0; i < Math.Min(phraseNotes.Length, newWords.Length); i++) {
                        phraseNotes[i].lyric = newWords[i];
                    }
                    
                    if (newWords.Length < phraseNotes.Length) {
                        for (int i = newWords.Length; i < phraseNotes.Length; i++) {
                            phraseNotes[i].lyric = newWords[^1];
                        }
                    }
                }
                
                // Save edited file
                var timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds();
                var editedPath = ustxPath.Replace(".ustx", $"_edited_{timestamp}.ustx");
                
                Ustx.Save(editedPath, project);
                Console.WriteLine($"✅ Saved batch edited file → {editedPath}");
                
                // Re-analyze if JSON output requested
                if (Environment.GetEnvironmentVariable("OPENUTAU_OUTPUT_JSON") == "true") {
                    var updatedPhrases = GetRenderPhrases(project, part, track, singer);
                    OutputPhrasesAsJson(updatedPhrases);
                }
                
            } catch (Exception ex) {
                Console.WriteLine($"❌ Batch edit failed: {ex.Message}");
            }
        }
        
        private static List<RenderPhrase> GetRenderPhrases(UProject project, UVoicePart part, UTrack track, USinger singer) {
            var phonemizer = track.Phonemizer;
            phonemizer.SetSinger(singer);
            phonemizer.SetTiming(project.timeAxis);
            
            // Group notes exactly like AnalyzeVerses
            var notes = part.notes.ToList();
            var groups = new List<Phonemizer.Note[]>();
            var groupToNote = new List<UNote>();
            
            for (int idx = 0; idx < notes.Count; idx++) {
                var note = notes[idx];
                if (note.OverlapError || note.Extends != null) {
                    continue;
                }
                var groupNotes = new List<UNote> { note };
                var next = note.Next;
                while (next != null && next.Extends == note) {
                    groupNotes.Add(next);
                    next = next.Next;
                }
                groups.Add(groupNotes.Select(n => n.ToPhonemizerNote(track, part)).ToArray());
                groupToNote.Add(note);
            }
            
            phonemizer.SetUp(groups.ToArray(), project, track);
            
            // Generate RenderPhrases like AnalyzeVerses does
            return RenderPhrase.FromPart(project, track, part).ToList();
        }
        
        private static void SavePhraseBoundaries(List<RenderPhrase> phrases, string ustxPath) {
            var boundariesPath = ustxPath.Replace(".ustx", ".boundaries.json");
            var boundaries = phrases.Select((phrase, index) => new {
                index = index + 1,
                startMs = phrase.positionMs,
                endMs = phrase.endMs,
                phraseCount = phrases.Count
            }).ToArray();
            
            var json = JsonSerializer.Serialize(boundaries, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(boundariesPath, json);
            Console.WriteLine($"💾 Saved phrase boundaries to: {boundariesPath}");
        }
        
        private static PhraseBoundary[] LoadPhraseBoundaries(string boundariesPath) {
            if (!File.Exists(boundariesPath)) {
                return null;
            }
            
            try {
                var json = File.ReadAllText(boundariesPath);
                var boundaries = JsonSerializer.Deserialize<PhraseBoundaryJson[]>(json);
                return boundaries.Select(b => new PhraseBoundary { 
                    StartMs = b.startMs, 
                    EndMs = b.endMs 
                }).ToArray();
            } catch (Exception ex) {
                Console.WriteLine($"⚠️ Failed to load boundaries: {ex.Message}");
                return null;
            }
        }
        
        private struct PhraseBoundary {
            public double StartMs { get; set; }
            public double EndMs { get; set; }
        }
        
        private struct PhraseBoundaryJson {
            public int index { get; set; }
            public double startMs { get; set; }
            public double endMs { get; set; }
            public int phraseCount { get; set; }
        }
        
        private static void OutputPhrasesAsJson(List<RenderPhrase> phrases) {
            var jsonPhrases = phrases.Select((phrase, index) => {
                var lyricalText = phrase.notes
                    .Where(n => !n.lyric.StartsWith("+"))
                    .Select(n => n.lyric)
                    .ToArray();
                
                return new {
                    phraseNumber = index + 1,
                    lyrics = string.Join(" ", lyricalText),
                    words = lyricalText.Length,
                    timing = $"{phrase.positionMs:F0}ms-{phrase.endMs:F0}ms"
                };
            }).ToList();
            
            var json = JsonSerializer.Serialize(jsonPhrases, new JsonSerializerOptions { WriteIndented = true });
            var tempFile = Path.GetTempFileName();
            File.WriteAllText(tempFile, json);
            Console.WriteLine($"JSON_FILE_PATH:{tempFile}");
        }
    }
}