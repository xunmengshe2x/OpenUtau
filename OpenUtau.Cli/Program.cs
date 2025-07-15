using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
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

namespace OpenUtau.Cli {
    class PhonemeTiming {
    public string PartName { get; set; } = string.Empty;
        public int NoteIndex { get; set; }
    public string Phoneme { get; set; } = string.Empty;
        public double TimeMs { get; set; }
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
                    "       dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> [output.json] [output.wav] --phoneme-override lyric:phoneme_index:old_phoneme:new_phoneme");
                return 1;
            }
            var ustxPath = args[0];
            var singerId = args[1];
            string outputPath = null;
            string outputWav = null;
            bool resetTimings = false;
            bool preserveSilenceTiming = false;
            var phonemeOverrides = new List<(string lyric, int phonemeIndex, string oldPhoneme, string newPhoneme)>();
            
            // Parse remaining arguments
            for (int i = 2; i < args.Length; i++) {
                var arg = args[i];
                if (arg.Equals("--reset-timings", StringComparison.OrdinalIgnoreCase)) {
                    resetTimings = true;
                } else if (arg.Equals("--preserve-silence-timing", StringComparison.OrdinalIgnoreCase)) {
                    preserveSilenceTiming = true;
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
                } else if (outputPath == null) {
                    outputPath = arg;
                }
            }
            Console.Error.WriteLine($"[DEBUG] outputWav parameter = '{outputWav}'");
            Console.Error.WriteLine($"[DEBUG] resetTimings = {resetTimings}");
            Console.Error.WriteLine($"[DEBUG] preserveSilenceTiming = {preserveSilenceTiming}");
            if (!File.Exists(ustxPath)) {
                Console.Error.WriteLine($"Error: USTX file not found: {ustxPath}");
                return 1;
            }
            // Support non-UTF8 encodings
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

            // If a local singer folder (matching the singer ID) resides alongside the USTX, use it directly
            var ustxDir = Path.GetDirectoryName(Path.GetFullPath(ustxPath));
            var localSingerPath = Path.Combine(ustxDir ?? string.Empty, singerId);
            if (Directory.Exists(localSingerPath)) {
                Preferences.Default.AdditionalSingerPath = localSingerPath;
                Preferences.Default.InstallToAdditionalSingersPath = true;
            }

            // Initialize singer and tools
            SingerManager.Inst.Initialize();
            ToolsManager.Inst.Initialize();
            // Register built-in & external phonemizer plugins and start the phonemizer runner
            DocManager.Inst.SearchAllPlugins();
            DocManager.Inst.SearchAllLegacyPlugins();
            DocManager.Inst.Initialize(Thread.CurrentThread, TaskScheduler.Current);

            UProject project;
            try {
                project = Ustx.Load(ustxPath);
            } catch (Exception e) {
                Console.Error.WriteLine($"Error: failed to load project: {e.Message}");
                return 1;
            }

            // Reset phoneme timings if requested
            if (resetTimings) {
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
            // fallback: if not found among installed singers, try loading a voicebank folder next to the USTX
            if (singer == null) {
                var voicebankDir = Path.Combine(ustxDir ?? string.Empty, singerId);
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
                        results.Add(new PhonemeTiming {
                            PartName = part.DisplayName,
                            NoteIndex = noteIndexCounter,
                            Phoneme = ph.phoneme,
                            TimeMs = ms,
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

            // Output JSON
            var options = new JsonSerializerOptions { WriteIndented = true };
            var output = JsonSerializer.Serialize(results, options);
            if (!string.IsNullOrEmpty(outputPath)) {
                File.WriteAllText(outputPath, output);
            } else {
                Console.WriteLine(output);
            }
            Console.Error.WriteLine($"[DEBUG] Skipping audio render block? outputWav.IsNullOrEmpty={string.IsNullOrEmpty(outputWav)}");
            if (!string.IsNullOrEmpty(outputWav)) {
            Console.Error.WriteLine("[DEBUG] Populating render phrases for audio rendering");
            foreach (var part in project.parts.OfType<UVoicePart>()) {
                var track = project.tracks[part.trackNo];
                // Ensure the renderer settings have been initialized (as GUI does on load)
                track.RendererSettings.Validate(track);
                part.renderPhrases = RenderPhrase
                    .FromPart(project, track, part)
                    .ToList();
                Console.Error.WriteLine(
                    $"[DEBUG] Part '{part.DisplayName}' → {part.renderPhrases.Count} render phrase(s)");
                
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
                Console.Error.WriteLine($"[DEBUG] Starting audio rendering of {allPhrases.Count} phrase(s)...");
                var renderer = Renderers.CreateRenderer(Renderers.GetDefaultRenderer(singer.SingerType));
                var samples = new List<float>();
                double lastPhraseEndMs = 0;
                
                for (int i = 0; i < allPhrases.Count; i++) {
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
                        
                        // Insert silence gap if there's a gap between phrases
                        if (i > 0 && silencePhraseStartMs > lastPhraseEndMs) {
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
                    
                    // Insert silence gap if there's a gap between phrases
                    if (i > 0 && phraseStartMs > lastPhraseEndMs) {
                        double gapMs = phraseStartMs - lastPhraseEndMs;
                        int gapSamples = (int)(gapMs * 44100 / 1000);
                        Console.Error.WriteLine($"[DEBUG]   Gap → inserting {gapMs:F2}ms ({gapSamples} samples) of silence");
                        samples.AddRange(new float[gapSamples]);
                    }
                    
                    var cancellationTokenSource = new CancellationTokenSource();
                    
                    RenderResult res;
                    try {
                        var renderTask = renderer.Render(
                            phrase,
                            new Progress(allPhrases.Count),
                            trackNo,
                            cancellationTokenSource,
                            false
                        );
                        
                        // Wait for either the render to complete or timeout
                        if (renderTask.Wait(TimeSpan.FromMinutes(2))) {
                            res = renderTask.Result;
                        } else {
                            Console.Error.WriteLine($"[ERROR] Phrase {i + 1} rendering timed out after 2 minutes - skipping");
                            cancellationTokenSource.Cancel();
                            continue;
                        }
                    } catch (Exception ex) {
                        Console.Error.WriteLine($"[ERROR] Phrase {i + 1} rendering failed: {ex.Message}");
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