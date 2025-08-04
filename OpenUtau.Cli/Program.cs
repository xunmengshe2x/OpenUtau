using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using OpenUtau.Api;
using OpenUtau.Core;
using OpenUtau.Core.Enunu;
using OpenUtau.Core.Ustx;
using Ustx = OpenUtau.Core.Format.Ustx;
using OpenUtau.Core.Format;
using OpenUtau.Classic;
using OpenUtau.Core.Util;
using System.Diagnostics;
using OpenUtau.Core.Render;
using OpenUtau.Core.SignalChain;
using NAudio.Wave;
using OpenUtau.Core.DiffSinger;
using Newtonsoft.Json;

namespace OpenUtau.Cli {
    class PhonemeTiming {
    public string PartName { get; set; } = string.Empty;
        public int NoteIndex { get; set; }
    public string Phoneme { get; set; } = string.Empty;
        public double TimeMs { get; set; }
        public int Position { get; set; }
        public int Duration { get; set; }
        public int End { get; set; }
    }

    class Program {
        static int Main(string[] args) {
            if (args.Length >= 1 && args[0].Equals("install", StringComparison.OrdinalIgnoreCase)) {
                if (args.Length < 2) {
                    Console.WriteLine(
                        "Usage: dotnet run --project OpenUtau.Cli -- install <dependency.oudep>");
                    return 1;
                }
                var archivePath = args[1];
                if (!File.Exists(archivePath)) {
                    Console.Error.WriteLine($"Error: dependency file not found: {archivePath}");
                    return 1;
                }
                try {
                    DependencyInstaller.Install(archivePath);
                    Console.WriteLine($"Installed dependency '{Path.GetFileName(archivePath)}'");
                    return 0;
                } catch (Exception e) {
                    Console.Error.WriteLine($"Error: failed to install dependency: {e.Message}");
                    return 1;
                }
            }
            if (args.Length < 2) {
                Console.WriteLine(
                    "Usage: dotnet run --project OpenUtau.Cli -- install <dependency.oudep>\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> [output.json] [output.wav]\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> <output.wav>\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> [output.json] [output.wav] --reset-timings\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> [output.json] [output.wav] --reset-timings --preserve-silence-timing\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> [output.json] [output.wav] --phoneme-override lyric:phoneme_index:old_phoneme:new_phoneme\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> <output.ds> --diffsinger [--no-pitch]\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> <phrases.json> --phrases-only\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> [output.json] [output.wav] --render-phrases 1,2,5\n" +
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> [output.json] [output.wav] --render-phrases 2 --trim-leading-silence");
                return 1;
            }
            var inputPath = args[0]; // Can be USTX or DS file
            var singerId = args[1];
            string outputPath = null;
            string outputWav = null;
            string outputDs = null;
            bool resetTimings = false;
            bool preserveSilenceTiming = false;
            bool diffsingerMode = false;
            bool exportPitch = true;
            bool phrasesOnly = false;
            bool trimLeadingSilence = false;
            var renderPhraseIndices = new List<int>();
            
            // Detect input file type
            var inputExtension = Path.GetExtension(inputPath).ToLowerInvariant();
            bool isUstxInput = inputExtension == ".ustx";
            var phonemeOverrides = new List<(string lyric, int phonemeIndex, string oldPhoneme, string newPhoneme)>();
            
            // Parse remaining arguments
            for (int i = 2; i < args.Length; i++) {
                var arg = args[i];
                if (arg.Equals("--reset-timings", StringComparison.OrdinalIgnoreCase)) {
                    resetTimings = true;
                } else if (arg.Equals("--preserve-silence-timing", StringComparison.OrdinalIgnoreCase)) {
                    preserveSilenceTiming = true;
                } else if (arg.Equals("--diffsinger", StringComparison.OrdinalIgnoreCase)) {
                    diffsingerMode = true;
                } else if (arg.Equals("--no-pitch", StringComparison.OrdinalIgnoreCase)) {
                    exportPitch = false;
                } else if (arg.Equals("--phrases-only", StringComparison.OrdinalIgnoreCase)) {
                    phrasesOnly = true;
                } else if (arg.Equals("--trim-leading-silence", StringComparison.OrdinalIgnoreCase)) {
                    trimLeadingSilence = true;
                } else if (arg.StartsWith("--render-phrases", StringComparison.OrdinalIgnoreCase)) {
                    if (i + 1 < args.Length) {
                        var phrasesSpec = args[i + 1];
                        var parts = phrasesSpec.Split(',');
                        foreach (var part in parts) {
                            if (int.TryParse(part.Trim(), out int phraseNum)) {
                                renderPhraseIndices.Add(phraseNum - 1); // Convert to 0-based index
                                Console.Error.WriteLine($"[DEBUG] Will render phrase {phraseNum} (index {phraseNum - 1})");
                            } else {
                                Console.Error.WriteLine($"[WARNING] Invalid phrase number in render-phrases: {part}");
                            }
                        }
                        i++; // Skip the next argument as it's the phrase specification
                    } else {
                        Console.Error.WriteLine("[WARNING] --render-phrases requires a specification argument");
                    }
                } else if (arg.StartsWith("--phoneme-override", StringComparison.OrdinalIgnoreCase)) {
                    if (i + 1 < args.Length) {
                        var overrideSpec = args[i + 1];
                        var parts = overrideSpec.Split(':');
                        if (parts.Length == 4) {
                            var lyric = parts[0];
                            if (int.TryParse(parts[1], out int phonemeIndex)) {
                                var oldPhoneme = parts[2];
                                var newPhoneme = parts[3];
                                phonemeOverrides.Add((lyric, phonemeIndex, oldPhoneme, newPhoneme));
                                Console.Error.WriteLine($"[DEBUG] Phoneme override added: '{lyric}' phoneme {phonemeIndex} '{oldPhoneme}' → '{newPhoneme}'");
                            } else {
                                Console.Error.WriteLine($"[WARNING] Invalid phoneme index in override: {overrideSpec}");
                            }
                        } else {
                            Console.Error.WriteLine($"[WARNING] Invalid phoneme override format: {overrideSpec}. Expected: lyric:phoneme_index:old_phoneme:new_phoneme");
                        }
                        i++; // Skip the next argument as it's the override specification
                    } else {
                        Console.Error.WriteLine("[WARNING] --phoneme-override requires a specification argument");
                    }
                } else if (Path.GetExtension(arg).Equals(".wav", StringComparison.OrdinalIgnoreCase)) {
                    outputWav = arg;
                } else if (Path.GetExtension(arg).Equals(".ds", StringComparison.OrdinalIgnoreCase)) {
                    outputDs = arg;
                    diffsingerMode = true; // Auto-enable DiffSinger mode for .ds files
                } else if (outputPath == null) {
                    outputPath = arg;
                }
            }
            Console.Error.WriteLine($"[DEBUG] outputWav parameter = '{outputWav}'");
            Console.Error.WriteLine($"[DEBUG] outputDs parameter = '{outputDs}'");
            Console.Error.WriteLine($"[DEBUG] diffsingerMode = {diffsingerMode}");
            Console.Error.WriteLine($"[DEBUG] exportPitch = {exportPitch}");
            Console.Error.WriteLine($"[DEBUG] resetTimings = {resetTimings}");
            Console.Error.WriteLine($"[DEBUG] preserveSilenceTiming = {preserveSilenceTiming}");
            Console.Error.WriteLine($"[DEBUG] Input file type: {(isUstxInput ? "USTX" : "Unknown")}");
            
            if (!File.Exists(inputPath)) {
                Console.Error.WriteLine($"Error: Input file not found: {inputPath}");
                return 1;
            }
            // Support non-UTF8 encodings
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

            // If a local singer folder (matching the singer ID) resides alongside the input file, use it directly
            var inputDir = Path.GetDirectoryName(Path.GetFullPath(inputPath));
            var localSingerPath = Path.Combine(inputDir ?? string.Empty, singerId);
            if (Directory.Exists(localSingerPath)) {
                Preferences.Default.AdditionalSingerPath = localSingerPath;
                Preferences.Default.InstallToAdditionalSingersPath = true;
            }

            // Initialize singer and tools
            Console.Error.WriteLine("[DEBUG] Initializing SingerManager...");
            SingerManager.Inst.Initialize();
            Console.Error.WriteLine("[DEBUG] Initializing ToolsManager...");
            ToolsManager.Inst.Initialize();
            
            // Register built-in & external phonemizer plugins and start the phonemizer runner
            Console.Error.WriteLine("[DEBUG] Searching plugins...");
            DocManager.Inst.SearchAllPlugins();
            DocManager.Inst.SearchAllLegacyPlugins();
            Console.Error.WriteLine("[DEBUG] Initializing DocManager...");
            DocManager.Inst.Initialize(Thread.CurrentThread, TaskScheduler.Current);

            UProject project = null;
            
            try {
                project = Ustx.Load(inputPath);
            } catch (Exception e) {
                Console.Error.WriteLine($"Error: failed to load project: {e.Message}");
                return 1;
            }

            // Reset phoneme timings if requested (only for USTX mode)
            if (resetTimings && project != null) {
                Console.Error.WriteLine("[DEBUG] Resetting phoneme timings and aliases for all notes");
                int timingResetCount = 0;
                int aliasResetCount = 0;
                int preservedSilenceCount = 0;
                foreach (var part in project.parts.OfType<UVoicePart>()) {
                    foreach (var note in part.notes) {
                        bool hadTimingOverrides = false;
                        bool hadAliasOverrides = false;
                        foreach (var phonemeOverride in note.phonemeOverrides) {
                            // Check if this is a SP/AP phoneme
                            bool isSilencePhoneme = phonemeOverride.phoneme != null && 
                                (phonemeOverride.phoneme.Equals("SP", StringComparison.OrdinalIgnoreCase) || 
                                 phonemeOverride.phoneme.Equals("AP", StringComparison.OrdinalIgnoreCase));
                            
                            if (isSilencePhoneme && preserveSilenceTiming) {
                                // Preserve ALL SP/AP phoneme information (timing + phoneme)
                                Console.Error.WriteLine($"[DEBUG] Fully preserving silence phoneme '{phonemeOverride.phoneme}' on note '{note.lyric}' index {phonemeOverride.index} (offset={phonemeOverride.offset})");
                                preservedSilenceCount++;
                            } else {
                                // Reset timing overrides
                                if (phonemeOverride.offset != null || phonemeOverride.preutterDelta != null || phonemeOverride.overlapDelta != null) {
                                    hadTimingOverrides = true;
                                    phonemeOverride.offset = null;
                                    phonemeOverride.preutterDelta = null;
                                    phonemeOverride.overlapDelta = null;
                                }
                                // Reset phoneme alias overrides, but preserve SP/AP phonemes even if timing is reset
                                if (phonemeOverride.phoneme != null) {
                                    if (isSilencePhoneme) {
                                        // Keep the SP/AP phoneme name but allow timing to be reset
                                        Console.Error.WriteLine($"[DEBUG] Preserving silence phoneme name '{phonemeOverride.phoneme}' on note '{note.lyric}' index {phonemeOverride.index} (timing reset)");
                                        preservedSilenceCount++;
                                    } else {
                                        hadAliasOverrides = true;
                                        phonemeOverride.phoneme = null;
                                    }
                                }
                            }
                        }
                        if (hadTimingOverrides) {
                            timingResetCount++;
                        }
                        if (hadAliasOverrides) {
                            aliasResetCount++;
                        }
                    }
                }
                Console.Error.WriteLine($"[DEBUG] Reset phoneme timing overrides for {timingResetCount} note(s)");
                Console.Error.WriteLine($"[DEBUG] Reset phoneme alias overrides for {aliasResetCount} note(s)");
                Console.Error.WriteLine($"[DEBUG] Preserved {preservedSilenceCount} silence phoneme(s) (SP/AP)");
            }

            var singer = SingerManager.Inst.GetSinger(singerId);
            // fallback: if not found among installed singers, try loading a voicebank folder next to the input file
            if (singer == null) {
                var voicebankDir = Path.Combine(inputDir ?? string.Empty, singerId);
                if (Directory.Exists(voicebankDir)) {
                    var loader = new VoicebankLoader(voicebankDir);
                    var banks = loader.SearchAll().ToList();
                    if (banks.Count > 0) {
                        singer = ClassicSingerLoader.AdjustSingerType(banks[0]);
                    }
                }
            }
            if (singer == null) {
                Console.Error.WriteLine($"Error: singer '{singerId}' not found.");
                return 1;
            }
            Console.Error.WriteLine($"[DEBUG] Singer loaded: Id='{singer.Id}', Name='{singer.Name}', Type='{singer.SingerType}', DefaultPhonemizer='{singer.DefaultPhonemizer}', Location='{singer.Location}'");
            
            // Debug environment info for Modal troubleshooting  
            Console.Error.WriteLine($"[DEBUG] Environment info:");
            Console.Error.WriteLine($"[DEBUG]   OS: {Environment.OSVersion}");
            Console.Error.WriteLine($"[DEBUG]   ProcessorCount: {Environment.ProcessorCount}");
            Console.Error.WriteLine($"[DEBUG]   WorkingSet: {Environment.WorkingSet / 1024 / 1024} MB");
            Console.Error.WriteLine($"[DEBUG]   Is64BitProcess: {Environment.Is64BitProcess}");
            Console.Error.WriteLine($"[DEBUG]   CurrentDirectory: {Environment.CurrentDirectory}");
            Console.Error.WriteLine($"[DEBUG]   Audio system available: {System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Linux)}");
            
            // Check ONNX Runtime configuration for DiffSinger
            Console.Error.WriteLine($"[DEBUG] ONNX Runtime Environment:");
            Console.Error.WriteLine($"[DEBUG]   Available ONNX runners: {string.Join(", ", OpenUtau.Core.Onnx.getRunnerOptions())}");
            Console.Error.WriteLine($"[DEBUG]   Current ONNX runner setting: {OpenUtau.Core.Util.Preferences.Default.OnnxRunner ?? "null (will default to CPU)"}");
            Console.Error.WriteLine($"[DEBUG]   ONNX GPU setting: {OpenUtau.Core.Util.Preferences.Default.OnnxGpu}");
            
            // Check if DiffSinger model files exist
            var singerPath = singer.Location;
            Console.Error.WriteLine($"[DEBUG] Singer location: {singerPath}");
            if (Directory.Exists(singerPath)) {
                var modelFiles = Directory.GetFiles(singerPath, "*.onnx", SearchOption.AllDirectories);
                Console.Error.WriteLine($"[DEBUG] Found {modelFiles.Length} .onnx model files:");
                foreach (var model in modelFiles.Take(5)) {
                    var fileInfo = new FileInfo(model);
                    Console.Error.WriteLine($"[DEBUG]   - {Path.GetFileName(model)} ({fileInfo.Length / 1024 / 1024} MB)");
                }
                if (modelFiles.Length > 5) {
                    Console.Error.WriteLine($"[DEBUG]   ... and {modelFiles.Length - 5} more");
                }
            }


            var timeAxis = project.timeAxis;
            var results = new List<PhonemeTiming>();

            // Process each voice part
            foreach (var part in project.parts.OfType<UVoicePart>()) {
                
                var track = project.tracks[part.trackNo];
                track.Singer = singer;
                // Use the phonemizer as configured in the USTX (via AfterLoad)
                var phonemizer = track.Phonemizer;
                Console.Error.WriteLine($"[DEBUG] Using phonemizer type: {phonemizer.GetType().FullName}");
                Console.Error.WriteLine($"[DEBUG] Phonemizer info: {phonemizer}");
                phonemizer.SetSinger(singer);
                phonemizer.SetTiming(timeAxis);
                Console.Error.WriteLine("[DEBUG] Phonemizer SetSinger and SetTiming complete");

                // Group notes into phonemizer note groups
                var notes = part.notes.ToList();
                var groups = new List<Phonemizer.Note[]>();
                var groupToNote = new List<UNote>(); // Track which UNote each group represents
                for (int idx = 0, noteIndex = 0; idx < notes.Count; idx++, noteIndex++) {
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
                    groupToNote.Add(note); // Store the primary note for this group
                }

                // Initialize phonemizer
                try {
                    Console.Error.WriteLine($"[DEBUG] Setting up phonemizer for part '{part.DisplayName}' with {groups.Count} groups");
                    phonemizer.SetUp(groups.ToArray(), project, track);
                    Console.Error.WriteLine("[DEBUG] Phonemizer SetUp complete");
                } catch (Exception e) {
                    Console.Error.WriteLine($"Error: phonemizer setup failed: {e.Message}");
                    continue;
                }

                // Phonemize each group in reverse order as in runner
                var phonemeResults = new List<Phonemizer.Phoneme[]>();
                for (int i = groups.Count - 1; i >= 0; i--) {
                    var grp = groups[i];
                    Phonemizer.Note? prev = null, nextPh = null;
                    Phonemizer.Note[] prevs = Array.Empty<Phonemizer.Note>();
                    bool prevIsNeighbour = false, nextIsNeighbour = false;
                    if (i > 0) {
                        prevs = groups[i - 1];
                        prev = prevs.FirstOrDefault();
                        var prevLast = prevs.Last();
                        prevIsNeighbour = prevLast.position + prevLast.duration >= grp[0].position;
                    }
                    if (i < groups.Count - 1) {
                        nextPh = groups[i + 1].FirstOrDefault();
                        var thisLast = grp.Last();
                        nextIsNeighbour = thisLast.position + thisLast.duration >= nextPh.Value.position;
                    }
                    // Adjust extender note duration if needed
                    if (nextPh != null && phonemeResults.Count > 0 && phonemeResults[0].Length > 0) {
                        var end = grp.Last().position + grp.Last().duration;
                        int push = Math.Min(0, phonemeResults[0][0].position - end);
                        grp[grp.Length - 1].duration += push;
                    }
                    Phonemizer.Result res;
                    // DEBUG: show input lyrics for this note group
                    Console.Error.WriteLine(
                        $"[DEBUG] Group {i} input lyrics: {string.Join(' ', grp.Select(n => '"' + n.lyric + '"'))}");
                    try {
                        res = phonemizer.Process(grp,
                            prev,
                            nextPh,
                            prevIsNeighbour ? prev : null,
                            nextIsNeighbour ? nextPh : null,
                            prevIsNeighbour ? prevs : Array.Empty<Phonemizer.Note>());
                    } catch (Exception e) {
                        Console.Error.WriteLine($"Error: phonemizer error on note group {i}: {e.Message}");
                        res = new Phonemizer.Result { phonemes = new[] { new Phonemizer.Phoneme { phoneme = "error" } } };
                    }
                    // DEBUG: dump raw phoneme aliases for this group
                    Console.Error.WriteLine($"[DEBUG] Group {i} raw phonemes: {string.Join(' ', res.phonemes.Select(p => p.phoneme))}");
                    if (phonemizer.LegacyMapping) {
                        for (int k = 0; k < res.phonemes.Length; k++) {
                            var ph = res.phonemes[k];
                            if (singer.TryGetMappedOto(ph.phoneme, grp[0].tone, out var oto)) {
                                res.phonemes[k].phoneme = oto.Alias;
                            }
                        }
                    }
                    // convert positions relative to project
                    for (int j = 0; j < res.phonemes.Length; j++) {
                        res.phonemes[j].position += grp[0].position;
                    }
                    // DEBUG: show mapped & positioned phonemes for this group
                    Console.Error.WriteLine($"[DEBUG] Group {i} mapped phonemes: {string.Join(' ', res.phonemes.Select(p => p.phoneme))}");
                    Console.Error.WriteLine($"[DEBUG] Group {i} phoneme tick positions: {string.Join(' ', res.phonemes.Select(p => p.position.ToString()))}");
                    phonemeResults.Insert(0, res.phonemes);
                }
                
                // Apply phoneme overrides
                if (phonemeOverrides.Count > 0) {
                    Console.Error.WriteLine($"[DEBUG] Applying {phonemeOverrides.Count} phoneme override(s)");
                    for (int gi = 0; gi < groups.Count; gi++) {
                        var grp = groups[gi];
                        var groupNote = groupToNote[gi];
                        var groupLyric = groupNote.lyric;
                        
                        foreach (var (targetLyric, phonemeIndex, oldPhoneme, newPhoneme) in phonemeOverrides) {
                            if (groupLyric.Equals(targetLyric, StringComparison.OrdinalIgnoreCase)) {
                                var phonemeArray = phonemeResults[gi];
                                if (phonemeIndex >= 0 && phonemeIndex < phonemeArray.Length) {
                                    var currentPhoneme = phonemeArray[phonemeIndex].phoneme;
                                    if (string.IsNullOrEmpty(oldPhoneme) || currentPhoneme.Equals(oldPhoneme, StringComparison.OrdinalIgnoreCase)) {
                                        Console.Error.WriteLine($"[DEBUG] Override applied: lyric '{groupLyric}' phoneme {phonemeIndex} '{currentPhoneme}' → '{newPhoneme}'");
                                        phonemeArray[phonemeIndex].phoneme = newPhoneme;
                                    } else {
                                        Console.Error.WriteLine($"[DEBUG] Override skipped: lyric '{groupLyric}' phoneme {phonemeIndex} expected '{oldPhoneme}' but found '{currentPhoneme}'");
                                    }
                                } else {
                                    Console.Error.WriteLine($"[DEBUG] Override skipped: lyric '{groupLyric}' phoneme index {phonemeIndex} out of range (0-{phonemeArray.Length - 1})");
                                }
                            }
                        }
                    }
                }
                
                phonemizer.CleanUp();
                Console.Error.WriteLine("[DEBUG] Phonemizer CleanUp complete");

                // Collect timing results & inject into part.phonemes for later rendering
                int noteIndexCounter = 0;
                for (int gi = 0; gi < groups.Count; gi++) {
                    for (int pi = 0; pi < phonemeResults[gi].Length; pi++) {
                        var ph = phonemeResults[gi][pi];
                        var ms = timeAxis.TickPosToMsPos(ph.position);
                        // DEBUG: phoneme timing for output
                        Console.Error.WriteLine($"[DEBUG] Group {gi}, phoneme #{pi}: '{ph.phoneme}' at tick {ph.position} (~{ms} ms)");
                        // Calculate duration from next phoneme position or note end
                        int duration = 0;
                        int end = ph.position;
                        if (pi + 1 < phonemeResults[gi].Length) {
                            // Use next phoneme position as end
                            end = phonemeResults[gi][pi + 1].position;
                            duration = end - ph.position;
                        } else if (gi + 1 < groups.Count && phonemeResults.Count > gi + 1) {
                            // Use first phoneme of next group as end
                            if (phonemeResults[gi + 1].Length > 0) {
                                end = phonemeResults[gi + 1][0].position;
                                duration = end - ph.position;
                            }
                        } else {
                            // Last phoneme, estimate duration
                            duration = 240; // Default duration in ticks
                            end = ph.position + duration;
                        }

                        results.Add(new PhonemeTiming {
                            PartName = part.DisplayName,
                            NoteIndex = noteIndexCounter,
                            Phoneme = ph.phoneme,
                            TimeMs = ms,
                            Position = ph.position,
                            Duration = duration,
                            End = end,
                        });
                    }
                    noteIndexCounter++;
                }
                // Inject phonemes into part for RenderPhrase.FromPart - UI-style processing
                part.phonemes.Clear();
                for (int gi = 0; gi < phonemeResults.Count; gi++) {
                    var group = phonemeResults[gi];
                    var parentNote = gi < groupToNote.Count ? groupToNote[gi] : null;
                    foreach (var ph in group) {
                        // UI-style phoneme creation: only set raw values initially
                        var up = new UPhoneme() {
                            rawPosition = ph.position - part.position,
                            rawPhoneme = ph.phoneme,
                            index = ph.index ?? 0,
                            Parent = parentNote
                        };
                        part.phonemes.Add(up);
                        
                        // Debug: show which phonemes are being added
                        if (ph.phoneme.Equals("SP", StringComparison.OrdinalIgnoreCase) || 
                            ph.phoneme.Equals("AP", StringComparison.OrdinalIgnoreCase)) {
                            Console.Error.WriteLine($"[DEBUG] Adding silence phoneme: '{ph.phoneme}' at position {ph.position}");
                        }
                    }
                }
                
                Console.Error.WriteLine($"[DEBUG] Created {part.phonemes.Count} phonemes, applying UI-style timing processing");
                
                // Apply phoneme overrides like the UI does (UPart.cs:213-229)
                foreach (var phoneme in part.phonemes) {
                    phoneme.position = phoneme.rawPosition;
                    phoneme.phoneme = phoneme.rawPhoneme;
                    phoneme.preutterDelta = null;
                    phoneme.overlapDelta = null;
                    
                    var note = phoneme.Parent;
                    if (note == null) {
                        continue;
                    }
                    
                    var o = note.phonemeOverrides.FirstOrDefault(o => o.index == phoneme.index);
                    if (o != null) {
                        phoneme.position += o.offset ?? 0;  // Critical timing adjustment
                        phoneme.phoneme = !string.IsNullOrWhiteSpace(o.phoneme) ? o.phoneme : phoneme.rawPhoneme;
                        phoneme.preutterDelta = o.preutterDelta;
                        phoneme.overlapDelta = o.overlapDelta;
                        Console.Error.WriteLine($"[DEBUG] Applied phoneme override: note '{note.lyric}' phoneme {phoneme.index} pos+={o.offset ?? 0} phoneme='{phoneme.phoneme}'");
                        
                        // Debug: Check if this created a silence phoneme
                        if (phoneme.phoneme.Equals("SP", StringComparison.OrdinalIgnoreCase) || 
                            phoneme.phoneme.Equals("AP", StringComparison.OrdinalIgnoreCase)) {
                            Console.Error.WriteLine($"[DEBUG] Created silence phoneme '{phoneme.phoneme}' via override");
                        }
                    }
                }
                
                // Safety treatment to prevent phoneme overlaps (UPart.cs:230-233)
                Console.Error.WriteLine("[DEBUG] Applying safety treatment to prevent phoneme overlaps");
                int overlapFixes = 0;
                for (int i = part.phonemes.Count - 2; i >= 0; --i) {
                    var currentPhoneme = part.phonemes[i];
                    var nextPhoneme = part.phonemes[i + 1];
                    var originalPosition = currentPhoneme.position;
                    currentPhoneme.position = Math.Min(currentPhoneme.position, nextPhoneme.position - 10);
                    if (currentPhoneme.position != originalPosition) {
                        overlapFixes++;
                    }
                }
                Console.Error.WriteLine($"[DEBUG] Safety treatment applied {overlapFixes} overlap fixes");
                
                // Validate the part to calculate phoneme durations and set up Prev/Next pointers
                var partTrack = project.tracks[part.trackNo];
                var validateOptions = new ValidateOptions {
                    SkipTiming = false,
                    Part = part,
                    SkipPhonemizer = true,
                    SkipPhoneme = false
                };
                part.Validate(validateOptions, project, partTrack);
                Console.Error.WriteLine($"[DEBUG] Phoneme validation completed for part '{part.DisplayName}'");
            }

            // Handle DiffSinger export
            if (diffsingerMode && !string.IsNullOrEmpty(outputDs)) {
                Console.Error.WriteLine("[DEBUG] Generating DiffSinger script export");
                try {
                    foreach (var part in project.parts.OfType<UVoicePart>()) {
                        Console.Error.WriteLine($"[DEBUG] Exporting DiffSinger script for part '{part.DisplayName}'");
                        Console.Error.WriteLine($"[DEBUG] Part has {part.notes.Count} notes, {part.phonemes.Count} phonemes");
                        Console.Error.WriteLine($"[DEBUG] Project has timeAxis: {project.timeAxis != null}");
                        Console.Error.WriteLine($"[DEBUG] Track singer: {project.tracks[part.trackNo].Singer?.Name ?? "null"}");
                        
                        // Generate render phrases if not already done
                        if (part.renderPhrases == null || part.renderPhrases.Count == 0) {
                            Console.Error.WriteLine("[DEBUG] Generating render phrases for DiffSinger export");
                            var track = project.tracks[part.trackNo];
                            track.RendererSettings.Validate(track);
                            part.renderPhrases = RenderPhrase.FromPart(project, track, part).ToList();
                            Console.Error.WriteLine($"[DEBUG] Generated {part.renderPhrases.Count} render phrases");
                        }
                        
                        DiffSingerScript.SavePart(project, part, outputDs, false, exportPitch);
                        Console.Error.WriteLine($"[DEBUG] DiffSinger script saved to {outputDs}");
                        break; // Only export first voice part for now
                    }
                } catch (Exception e) {
                    Console.Error.WriteLine($"Error: DiffSinger export failed: {e.Message}");
                    Console.Error.WriteLine($"Stack trace: {e.StackTrace}");
                    return 1;
                }
            }

            // Output JSON (only if not DiffSinger mode or if outputPath is explicitly specified)
            if (!diffsingerMode || !string.IsNullOrEmpty(outputPath)) {
                var options = new JsonSerializerOptions { WriteIndented = true };
                var output = System.Text.Json.JsonSerializer.Serialize(results, options);
                if (!string.IsNullOrEmpty(outputPath)) {
                    File.WriteAllText(outputPath, output);
                } else if (!diffsingerMode) {
                    Console.WriteLine(output);
                }
            }
            Console.Error.WriteLine($"[DEBUG] Skipping audio render block? outputWav.IsNullOrEmpty={string.IsNullOrEmpty(outputWav)}");
            if (!string.IsNullOrEmpty(outputWav)) {
            Console.Error.WriteLine("[DEBUG] Starting audio rendering process");
            Console.Error.WriteLine("[DEBUG] Populating render phrases for audio rendering");
            foreach (var part in project.parts.OfType<UVoicePart>()) {
                var track = project.tracks[part.trackNo];
                Console.Error.WriteLine($"[DEBUG] Processing part '{part.DisplayName}' with {part.phonemes.Count} phonemes");
                
                try {
                    // Ensure the renderer settings have been initialized (as GUI does on load)
                    Console.Error.WriteLine("[DEBUG] Validating renderer settings...");
                    track.RendererSettings.Validate(track);
                    Console.Error.WriteLine("[DEBUG] Renderer settings validated successfully");
                    
                    Console.Error.WriteLine("[DEBUG] Generating render phrases...");
                    Console.Error.WriteLine($"[DEBUG] About to call RenderPhrase.FromPart for part with {part.phonemes.Count} phonemes");
                    
                    // Add timeout mechanism to prevent infinite hangs
                    var renderTask = Task.Run(() => {
                        return RenderPhrase.FromPart(project, track, part).ToList();
                    });
                    
                    if (renderTask.Wait(TimeSpan.FromMinutes(2))) {
                        part.renderPhrases = renderTask.Result;
                        Console.Error.WriteLine($"[DEBUG] Part '{part.DisplayName}' → {part.renderPhrases.Count} render phrase(s)");
                    } else {
                        Console.Error.WriteLine($"[ERROR] RenderPhrase.FromPart timed out after 2 minutes for part '{part.DisplayName}'");
                        return 1;
                    }
                } catch (Exception ex) {
                    Console.Error.WriteLine($"[ERROR] Failed to generate render phrases for part '{part.DisplayName}': {ex.Message}");
                    Console.Error.WriteLine($"[ERROR] Stack trace: {ex.StackTrace}");
                    return 1;
                }
                
                // Debug: check for SP/AP phonemes in render phrases
                foreach (var phrase in part.renderPhrases) {
                    var silencePhones = phrase.phones.Where(p => 
                        p.phoneme.Equals("SP", StringComparison.OrdinalIgnoreCase) || 
                        p.phoneme.Equals("AP", StringComparison.OrdinalIgnoreCase)).ToList();
                    if (silencePhones.Any()) {
                        Console.Error.WriteLine($"[DEBUG] Found {silencePhones.Count} silence phones in phrase: {string.Join(", ", silencePhones.Select(p => p.phoneme))}");
                    }
                }
            }
                var allPhrases = project.parts.OfType<UVoicePart>()
                    .SelectMany(vp => vp.renderPhrases.Select(rp => (vp.trackNo, rp)))
                    .ToList();
                Console.Error.WriteLine($"[DEBUG] Generated {allPhrases.Count} phrase(s) for processing...");

                // If --phrases-only flag is set, export phrases and exit
                if (phrasesOnly) {
                    Console.Error.WriteLine($"[DEBUG] Phrases-only mode: exporting {allPhrases.Count} phrases to JSON");
                    
                    var phrasesData = new {
                        totalPhrases = allPhrases.Count,
                        phrases = allPhrases.Select((phraseInfo, index) => new {
                            phraseNumber = index + 1,
                            trackNo = phraseInfo.trackNo,
                            startTimeMs = phraseInfo.rp.positionMs,
                            endTimeMs = phraseInfo.rp.positionMs + phraseInfo.rp.durationMs,
                            durationMs = phraseInfo.rp.durationMs,
                            phonemes = phraseInfo.rp.phones.Select(phone => new {
                                phoneme = phone.phoneme,
                                positionMs = phone.positionMs,
                                durationMs = phone.durationMs
                            }).ToList(),
                            lyrics = string.Join(" ", phraseInfo.rp.notes
                                .Select(n => n.lyric)
                                .Where(l => !string.IsNullOrEmpty(l) && !l.StartsWith("+")))
                        }).ToList()
                    };
                    
                    // Write phrases to output file
                    var phrasesJson = System.Text.Json.JsonSerializer.Serialize(phrasesData, new JsonSerializerOptions { 
                        WriteIndented = true 
                    });
                    
                    if (!string.IsNullOrEmpty(outputPath)) {
                        File.WriteAllText(outputPath, phrasesJson, Encoding.UTF8);
                        Console.Error.WriteLine($"[DEBUG] Phrases exported to: {outputPath}");
                    } else {
                        Console.WriteLine(phrasesJson);
                    }
                    
                    Console.Error.WriteLine($"[DEBUG] Phrases-only export completed successfully");
                    return 0;
                }

                // Determine which phrases to render
                var phrasesToRender = renderPhraseIndices.Count > 0 
                    ? renderPhraseIndices.Where(i => i >= 0 && i < allPhrases.Count).ToList()
                    : Enumerable.Range(0, allPhrases.Count).ToList();
                
                Console.Error.WriteLine($"[DEBUG] Starting audio rendering of {phrasesToRender.Count} phrase(s) out of {allPhrases.Count} total...");
                if (renderPhraseIndices.Count > 0) {
                    Console.Error.WriteLine($"[DEBUG] Rendering specific phrases: {string.Join(", ", phrasesToRender.Select(i => i + 1))}");
                }
                
                var defaultRendererType = Renderers.GetDefaultRenderer(singer.SingerType);
                Console.Error.WriteLine($"[DEBUG] Default renderer for singer type '{singer.SingerType}': {defaultRendererType}");
                var renderer = Renderers.CreateRenderer(defaultRendererType);
                Console.Error.WriteLine($"[DEBUG] Created renderer: {renderer.GetType().FullName}");
                var samples = new List<float>();
                double lastPhraseEndMs = 0;
                double firstPhraseStartMs = -1; // Track first phrase timing for trimming
                
                for (int idx = 0; idx < phrasesToRender.Count; idx++) {
                    int i = phrasesToRender[idx];
                    var (trackNo, phrase) = allPhrases[i];
                    Console.Error.WriteLine($"[DEBUG] Rendering phrase {i + 1}/{allPhrases.Count} (track {trackNo})...");
                    
                    // Check if this phrase contains only SP/AP phonemes (silence/pause)
                    bool isSilencePhrase = phrase.phones.All(p => 
                        p.phoneme.Equals("SP", StringComparison.OrdinalIgnoreCase) || 
                        p.phoneme.Equals("AP", StringComparison.OrdinalIgnoreCase));
                    
                    if (isSilencePhrase) {
                        Console.Error.WriteLine($"[DEBUG]   Phrase contains only silence phonemes (SP/AP), generating silence");
                        var silenceLayout = renderer.Layout(phrase);
                        double silencePhraseStartMs = silenceLayout.positionMs - silenceLayout.leadingMs;
                        
                        // Track first phrase start time for trimming
                        if (firstPhraseStartMs == -1) {
                            firstPhraseStartMs = silencePhraseStartMs;
                        }
                        
                        // Skip silence phrase if trimming and this is first phrase
                        if (idx == 0 && trimLeadingSilence) {
                            Console.Error.WriteLine($"[DEBUG]   Skipping leading silence phrase when trimming");
                            continue;
                        }
                        
                        // Insert silence gap if there's a gap between phrases (unless this is first phrase in render list)
                        if (idx > 0 && silencePhraseStartMs > lastPhraseEndMs) {
                            double gapMs = silencePhraseStartMs - lastPhraseEndMs;
                            int gapSamples = (int)(gapMs * 44100 / 1000);
                            Console.Error.WriteLine($"[DEBUG]   Gap → inserting {gapMs:F2}ms ({gapSamples} samples) of silence");
                            samples.AddRange(new float[gapSamples]);
                        }
                        
                        // Generate silence for the duration of this phrase
                        int silenceSamples = (int)(silenceLayout.estimatedLengthMs * 44100 / 1000);
                        Console.Error.WriteLine($"[DEBUG]   Generating {silenceLayout.estimatedLengthMs:F2}ms ({silenceSamples} samples) of silence for SP/AP phonemes");
                        samples.AddRange(new float[silenceSamples]);
                        
                        // Update last phrase end time
                        lastPhraseEndMs = silencePhraseStartMs + silenceLayout.estimatedLengthMs;
                        continue;
                    }
                    
                    var layout = renderer.Layout(phrase);
                    Console.Error.WriteLine(
                        $"[DEBUG]   Layout → estLenMs={layout.estimatedLengthMs}, leadingMs={layout.leadingMs}, positionMs={layout.positionMs}");
                    
                    // Calculate phrase start time (accounting for leading silence)
                    double phraseStartMs = layout.positionMs - layout.leadingMs;
                    
                    // Track first phrase start time for trimming
                    if (firstPhraseStartMs == -1) {
                        firstPhraseStartMs = phraseStartMs;
                    }
                    
                    // Insert silence gap if there's a gap between phrases (unless trimming and this is first phrase in render list)
                    if (idx > 0 && phraseStartMs > lastPhraseEndMs) {
                        double gapMs = phraseStartMs - lastPhraseEndMs;
                        int gapSamples = (int)(gapMs * 44100 / 1000);
                        Console.Error.WriteLine($"[DEBUG]   Gap → inserting {gapMs:F2}ms ({gapSamples} samples) of silence");
                        samples.AddRange(new float[gapSamples]);
                    } else if (idx == 0 && trimLeadingSilence) {
                        // Skip initial silence for first phrase when trimming
                        Console.Error.WriteLine($"[DEBUG]   Trimming {phraseStartMs:F2}ms of leading silence (phrase {i + 1})");
                        lastPhraseEndMs = 0; // Reset timeline to start immediately
                    }
                    
                    var cancellationTokenSource = new CancellationTokenSource();
                    
                    RenderResult res;
                    try {
                        Console.Error.WriteLine($"[DEBUG]   Starting renderer.Render() call for phrase {i + 1}...");
                        var renderTask = renderer.Render(
                            phrase,
                            new Progress(allPhrases.Count),
                            trackNo,
                            cancellationTokenSource,
                            false
                        );
                        
                        Console.Error.WriteLine($"[DEBUG]   Render task created, waiting for completion...");
                        // Wait for either the render to complete or timeout
                        if (renderTask.Wait(TimeSpan.FromMinutes(2))) {
                            res = renderTask.Result;
                            Console.Error.WriteLine($"[DEBUG]   Render completed successfully for phrase {i + 1}");
                        } else {
                            Console.Error.WriteLine($"[ERROR] Phrase {i + 1} rendering timed out after 2 minutes - skipping");
                            cancellationTokenSource.Cancel();
                            continue;
                        }
                    } catch (Exception ex) {
                        Console.Error.WriteLine($"[ERROR] Phrase {i + 1} rendering failed: {ex.Message}");
                        Console.Error.WriteLine($"[ERROR] Exception details: {ex}");
                        continue; // Skip this phrase and continue with the next
                    }
                    Console.Error.WriteLine(
                        $"[DEBUG]   Render → samples.Length={(res.samples?.Length ?? 0)}, leadingMs={res.leadingMs}, positionMs={res.positionMs}, estimatedLengthMs={res.estimatedLengthMs}");
                    
                    if (res.samples != null) {
                        // Apply dynamics processing like the UI
                        Renderers.ApplyDynamics(phrase, res);
                        
                        // Apply basic volume control (simplified)
                        var track = project.tracks[trackNo];
                        var volumeScale = PlaybackManager.DecibelToVolume(track.Muted ? -24 : track.Volume);
                        if (volumeScale != 1.0f) {
                            for (int j = 0; j < res.samples.Length; j++) {
                                res.samples[j] *= volumeScale;
                            }
                        }
                        
                        samples.AddRange(res.samples);
                        // Update last phrase end time
                        lastPhraseEndMs = phraseStartMs + (res.samples.Length * 1000.0 / 44100);
                    }
                }
                
                var finalSamples = samples.ToArray();
                
                Console.Error.WriteLine($"[DEBUG] Final mix: {finalSamples.Length} samples ({finalSamples.Length * 1000.0 / 44100:F2}ms)");
                
                // Export as 16-bit WAV like the UI
                var wavDir = Path.GetDirectoryName(outputWav);
                if (string.IsNullOrEmpty(wavDir)) wavDir = ".";
                Directory.CreateDirectory(wavDir);
                
                // Convert to 16-bit and write
                var samples16 = new short[finalSamples.Length];
                for (int i = 0; i < finalSamples.Length; i++) {
                    samples16[i] = (short)(Math.Max(-1f, Math.Min(1f, finalSamples[i])) * 32767);
                }
                
                using var writer = new WaveFileWriter(outputWav, new WaveFormat(44100, 16, 1));
                writer.WriteSamples(samples16, 0, samples16.Length);
                Console.Error.WriteLine($"16-bit WAV written to {outputWav}");
            }
            return 0;
        }

    }
}