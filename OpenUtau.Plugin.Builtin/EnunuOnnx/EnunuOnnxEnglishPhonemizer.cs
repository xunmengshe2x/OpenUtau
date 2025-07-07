using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using OpenUtau.Api;
using OpenUtau.Core.G2p;
using Serilog;

namespace OpenUtau.Plugin.Builtin {
    [Phonemizer("Enunu Onnx English Phonemizer", "ENUNU X EN", language:"EN")]
    public class EnunuOnnxEnglishPhonemizer : EnunuOnnxPhonemizer {
        protected override IG2p LoadG2p(string rootPath) {
            var g2ps = new List<IG2p>();

            // Load dictionary from singer folder.
            // Load dictionary from singer folder; support either root or enunux subfolder
            foreach (var candidate in new[] {
                Path.Combine(rootPath, "enunux.yaml"),
                Path.Combine(rootPath, "enunux", "enunux.yaml")
            }) {
                if (File.Exists(candidate)) {
                    try {
                        g2ps.Add(G2pDictionary.NewBuilder().Load(File.ReadAllText(candidate)).Build());
                    } catch (Exception e) {
                        Log.Error(e, $"Failed to load {candidate}");
                    }
                    break;
                }
            }
            g2ps.Add(new ArpabetG2p());
            return new G2pFallbacks(g2ps.ToArray());
        }

    }
}
