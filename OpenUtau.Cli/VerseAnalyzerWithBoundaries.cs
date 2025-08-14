using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using OpenUtau.Api;
using OpenUtau.Classic;
using OpenUtau.Core;
using OpenUtau.Core.DiffSinger;
using OpenUtau.Core.Format;
using OpenUtau.Core.Render;
using OpenUtau.Core.Ustx;
using OpenUtau.Core.Util;
using Newtonsoft.Json;

namespace OpenUtau.Cli {
    public class VerseAnalyzerWithBoundaries {
        public static void AnalyzeVerses(string ustxPath, bool interactive = false) {
            Console.WriteLine("============================================================");
            Console.WriteLine("OpenUtau Verse Analysis - Preserve Boundaries Version");
            Console.WriteLine("============================================================");

            try {
                // Initialize exactly like the working CLI
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
                
                var inputDir = Path.GetDirectoryName(Path.GetFullPath(ustxPath));
                var localSingerPath = Path.Combine(inputDir ?? string.Empty, "fem_1_ln");
                if (Directory.Exists(localSingerPath)) {
                    Preferences.Default.AdditionalSingerPath = localSingerPath;
                    Preferences.Default.InstallToAdditionalSingersPath = true;
                    Console.WriteLine($"✅ Found local singer path: {localSingerPath}");
                }
                
                SingerManager.Inst.Initialize();
                ToolsManager.Inst.Initialize();
                DocManager.Inst.SearchAllPlugins();
                DocManager.Inst.SearchAllLegacyPlugins();
                DocManager.Inst.Initialize(System.Threading.Thread.CurrentThread, System.Threading.Tasks.TaskScheduler.Current);
                
                // Load the USTX project
                var project = Ustx.Load(ustxPath);
                Console.WriteLine($"✅ Loaded: {project.name}");
                
                // Get the singer
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
                Console.WriteLine($"✅ Singer: {singer.Name}");
                
                // Process voice parts (using working approach from VerseAnalyzerSimple)
                foreach (var part in project.parts.OfType<UVoicePart>()) {
                    var track = project.tracks[part.trackNo];
                    track.Singer = singer;
                    
                    var phonemizer = track.Phonemizer;
                    Console.WriteLine($"✅ Phonemizer: {phonemizer.Name}");
                    
                    phonemizer.SetSinger(singer);
                    phonemizer.SetTiming(project.timeAxis);
                    
                    // Group notes exactly like working CLI
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
                    
                    Console.WriteLine($"📊 Original structure: {groups.Count} phrases");
                    
                    // Initialize phonemizer (original sequential approach)
                    phonemizer.SetUp(groups.ToArray(), project, track);
                    
                    // Generate verse analysis
                    var verses = AnalyzeVersesFromNotes(part.notes.ToArray());
                    
                    // Output based on environment variable
                    if (Environment.GetEnvironmentVariable("OPENUTAU_OUTPUT_JSON") == "true") {
                        OutputVersesAsJson(verses);
                    } else {
                        OutputVersesToConsole(verses, interactive);
                    }
                    
                    break; // Process only first voice part
                }
                
            } catch (Exception ex) {
                Console.WriteLine($"❌ Error: {ex.Message}");
                Console.WriteLine($"Stack: {ex.StackTrace}");
            }
        }
        
        private static void OutputVersesAsJson(List<VerseInfo> verses) {
            var jsonVerses = verses.Select(v => new {
                phraseNumber = v.Number,
                lyrics = v.Lyrics,
                words = v.WordCount,
                timing = $"{v.StartIndex}-{v.EndIndex}"
            }).ToList();
            
            var json = JsonConvert.SerializeObject(jsonVerses, Formatting.Indented);
            
            // Create temp file for JSON output
            var tempFile = Path.GetTempFileName();
            File.WriteAllText(tempFile, json);
            Console.WriteLine($"JSON_FILE_PATH:{tempFile}");
        }
        
        private static void OutputVersesToConsole(List<VerseInfo> verses, bool interactive) {
            Console.WriteLine($"\n🎵 Found {verses.Count} verse phrases:");
            
            foreach (var verse in verses) {
                Console.WriteLine($"Phrase {verse.Number}:");
                Console.WriteLine($"text: \"{verse.Lyrics}\"");
                Console.WriteLine($"words: {verse.WordCount}");
                Console.WriteLine($"timing: {verse.StartIndex}-{verse.EndIndex}");
                Console.WriteLine();
            }
            
            if (interactive) {
                Console.WriteLine("Enter 'q' to quit, or phrase number to edit:");
                var input = Console.ReadLine();
                if (input?.ToLower() != "q" && int.TryParse(input, out int phraseNum)) {
                    Console.WriteLine($"Enter new lyrics for phrase {phraseNum}:");
                    var newLyrics = Console.ReadLine();
                    if (!string.IsNullOrEmpty(newLyrics)) {
                        Console.WriteLine($"Would edit phrase {phraseNum} to: {newLyrics}");
                    }
                }
            }
        }
        
        private static List<VerseInfo> AnalyzeVersesFromNotes(UNote[] notes) {
            var verses = new List<VerseInfo>();
            var verseNumber = 1;
            var startIndex = 0;
            
            for (int i = 0; i < notes.Length; i++) {
                var note = notes[i];
                
                // Skip extension notes
                if (note.lyric.StartsWith("+")) {
                    continue;
                }
                
                // Check for verse boundary (large time gap)
                bool isVerseBoundary = false;
                
                if (i > startIndex) {
                    var prevNote = notes[i - 1];
                    var gap = note.position - (prevNote.position + prevNote.duration);
                    
                    // Large gap indicates verse boundary
                    if (gap > 480) { // 1/4 note at 120 BPM
                        isVerseBoundary = true;
                    }
                }
                
                if (isVerseBoundary || i == notes.Length - 1) {
                    // Create verse from startIndex to current position
                    var verseNotes = notes.Skip(startIndex).Take(i - startIndex + 1)
                        .Where(n => !n.lyric.StartsWith("+"))
                        .ToArray();
                    
                    if (verseNotes.Any()) {
                        var lyrics = string.Join(" ", verseNotes.Select(n => n.lyric));
                        
                        verses.Add(new VerseInfo {
                            Number = verseNumber,
                            StartIndex = startIndex,
                            EndIndex = i,
                            Lyrics = lyrics,
                            WordCount = verseNotes.Length
                        });

                        verseNumber++;
                        startIndex = i;
                    }
                }
            }

            return verses;
        }
        
        public static void EditPhrase(string ustxPath, int phraseNumber, string newLyrics) {
            try {
                Console.WriteLine($"🎵 Editing phrase {phraseNumber} in {ustxPath}");
                Console.WriteLine($"📝 New lyrics: \"{newLyrics}\"");
                
                // Initialize systems
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
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
                
                // Analyze verses to find the target phrase
                var verses = AnalyzeVersesFromNotes(part.notes.ToArray());
                var targetVerse = verses.FirstOrDefault(v => v.Number == phraseNumber);
                
                if (targetVerse == null) {
                    Console.WriteLine($"❌ Phrase {phraseNumber} not found");
                    return;
                }
                
                // Split new lyrics into words
                var newWords = newLyrics.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                
                // Find the actual notes for this verse
                var verseNotes = part.notes
                    .Skip(targetVerse.StartIndex)
                    .Take(targetVerse.EndIndex - targetVerse.StartIndex + 1)
                    .Where(n => !n.lyric.StartsWith("+"))
                    .ToArray();
                
                Console.WriteLine($"📊 Original verse has {verseNotes.Length} notes, new lyrics has {newWords.Length} words");
                
                // Update the lyrics
                for (int i = 0; i < Math.Min(verseNotes.Length, newWords.Length); i++) {
                    verseNotes[i].lyric = newWords[i];
                }
                
                // Handle mismatch in word count
                if (newWords.Length > verseNotes.Length) {
                    Console.WriteLine($"⚠️ More words ({newWords.Length}) than notes ({verseNotes.Length}) - truncating lyrics");
                } else if (newWords.Length < verseNotes.Length) {
                    Console.WriteLine($"⚠️ Fewer words ({newWords.Length}) than notes ({verseNotes.Length}) - padding with last word");
                    for (int i = newWords.Length; i < verseNotes.Length; i++) {
                        verseNotes[i].lyric = newWords[^1]; // Use last word
                    }
                }
                
                // Save the edited file
                var timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds();
                var editedPath = ustxPath.Replace(".ustx", $"_edited_{timestamp}.ustx");
                
                Ustx.Save(editedPath, project);
                Console.WriteLine($"✅ Saved edited file → {editedPath}");
                
                // Re-analyze and output JSON
                var updatedVerses = AnalyzeVersesFromNotes(part.notes.ToArray());
                if (Environment.GetEnvironmentVariable("OPENUTAU_OUTPUT_JSON") == "true") {
                    OutputVersesAsJson(updatedVerses);
                }
                
            } catch (Exception ex) {
                Console.WriteLine($"❌ Edit failed: {ex.Message}");
            }
        }
        
        public static void BatchEditPhrases(string ustxPath, string batchEditString) {
            try {
                Console.WriteLine($"🎵 Batch editing phrases in {ustxPath}");
                
                // Parse batch edit string: "phrase1:lyrics1;phrase2:lyrics2"
                var edits = new Dictionary<int, string>();
                foreach (var edit in batchEditString.Split(';')) {
                    var parts = edit.Split(':', 2);
                    if (parts.Length == 2 && int.TryParse(parts[0], out int phraseNum)) {
                        edits[phraseNum] = parts[1];
                    }
                }
                
                Console.WriteLine($"📝 Parsed {edits.Count} edit commands");
                
                // Initialize systems
                Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
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
                
                // Apply each edit
                var verses = AnalyzeVersesFromNotes(part.notes.ToArray());
                
                foreach (var edit in edits) {
                    var phraseNumber = edit.Key;
                    var newLyrics = edit.Value;
                    var targetVerse = verses.FirstOrDefault(v => v.Number == phraseNumber);
                    
                    if (targetVerse == null) {
                        Console.WriteLine($"⚠️ Skipping phrase {phraseNumber} - not found");
                        continue;
                    }
                    
                    Console.WriteLine($"✏️ Editing phrase {phraseNumber}: \"{newLyrics}\"");
                    
                    var newWords = newLyrics.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    var verseNotes = part.notes
                        .Skip(targetVerse.StartIndex)
                        .Take(targetVerse.EndIndex - targetVerse.StartIndex + 1)
                        .Where(n => !n.lyric.StartsWith("+"))
                        .ToArray();
                    
                    // Update lyrics for this phrase
                    for (int i = 0; i < Math.Min(verseNotes.Length, newWords.Length); i++) {
                        verseNotes[i].lyric = newWords[i];
                    }
                    
                    if (newWords.Length < verseNotes.Length) {
                        for (int i = newWords.Length; i < verseNotes.Length; i++) {
                            verseNotes[i].lyric = newWords[^1];
                        }
                    }
                }
                
                // Save the edited file
                var timestamp = DateTimeOffset.Now.ToUnixTimeMilliseconds();
                var editedPath = ustxPath.Replace(".ustx", $"_edited_{timestamp}.ustx");
                
                Ustx.Save(editedPath, project);
                Console.WriteLine($"✅ Saved batch edited file → {editedPath}");
                
                // Re-analyze and output JSON
                var updatedVerses = AnalyzeVersesFromNotes(part.notes.ToArray());
                if (Environment.GetEnvironmentVariable("OPENUTAU_OUTPUT_JSON") == "true") {
                    OutputVersesAsJson(updatedVerses);
                }
                
            } catch (Exception ex) {
                Console.WriteLine($"❌ Batch edit failed: {ex.Message}");
            }
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