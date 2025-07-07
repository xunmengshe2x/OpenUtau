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

namespace OpenUtau.Cli {
    class PhonemeTiming {
    public string PartName { get; set; } = string.Empty;
        public int NoteIndex { get; set; }
    public string Phoneme { get; set; } = string.Empty;
        public double TimeMs { get; set; }
    }

    class Program {
        static int Main(string[] args) {
            if (args.Length < 2) {
                Console.WriteLine("Usage: dotnet run --project OpenUtau.Cli -- <ustx-file> <singer-id> [output.json]");
                return 1;
            }
            var ustxPath = args[0];
            var singerId = args[1];
            var outputPath = args.Length >= 3 ? args[2] : null;
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

            UProject project;
            try {
                project = Ustx.Load(ustxPath);
            } catch (Exception e) {
                Console.Error.WriteLine($"Error: failed to load project: {e.Message}");
                return 1;
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

            var timeAxis = project.timeAxis;
            var results = new List<PhonemeTiming>();

            // Process each voice part
            foreach (var part in project.parts.OfType<UVoicePart>()) {
                var track = project.tracks[part.trackNo];
                track.Singer = singer;
                // Use the phonemizer as configured in the USTX (via AfterLoad)
                var phonemizer = track.Phonemizer;
                Console.Error.WriteLine($"[DEBUG] Using phonemizer: {phonemizer.GetType().FullName}");
                phonemizer.SetSinger(singer);
                phonemizer.SetTiming(timeAxis);
                Console.Error.WriteLine("[DEBUG] Phonemizer SetSinger and SetTiming complete");

                // Group notes into phonemizer note groups
                var notes = part.notes.ToList();
                var groups = new List<Phonemizer.Note[]>();
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
                    phonemeResults.Insert(0, res.phonemes);
                }
                phonemizer.CleanUp();
                Console.Error.WriteLine("[DEBUG] Phonemizer CleanUp complete");

                // Collect timing results
                int noteIndexCounter = 0;
                for (int gi = 0; gi < groups.Count; gi++) {
                    for (int pi = 0; pi < phonemeResults[gi].Length; pi++) {
                        var ph = phonemeResults[gi][pi];
                        var ms = timeAxis.TickPosToMsPos(ph.position);
                        results.Add(new PhonemeTiming {
                            PartName = part.DisplayName,
                            NoteIndex = noteIndexCounter,
                            Phoneme = ph.phoneme,
                            TimeMs = ms,
                        });
                    }
                    noteIndexCounter++;
                }
            }

            // Output JSON
            var options = new JsonSerializerOptions { WriteIndented = true };
            var output = JsonSerializer.Serialize(results, options);
            if (!string.IsNullOrEmpty(outputPath)) {
                File.WriteAllText(outputPath, output);
            } else {
                Console.WriteLine(output);
            }
            return 0;
        }
    }
}