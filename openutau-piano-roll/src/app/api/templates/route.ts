import { NextRequest, NextResponse } from 'next/server';

// Embedded template data for Vercel compatibility
const TEMPLATE_DATA = {
  still_here_original: {
    name: "still_here",
    comment: "",
    output_dir: "Vocal",
    cache_dir: "UCache",
    ustx_version: "0.6",
    resolution: 480,
    bpm: 135,
    beat_per_bar: 3,
    beat_unit: 4,
    expressions: {
      dyn: { abbr: "dyn", name: "dynamics", type: "Curve", min: -240, max: 120, default_value: 0, is_flag: false, flag: "" },
      pitd: { abbr: "pitd", name: "pitch deviation", type: "Curve", min: -1200, max: 1200, default_value: 0, is_flag: false, flag: "" },
      clr: { abbr: "clr", name: "voice color", type: "Options", min: 0, max: 0, default_value: 0, is_flag: false, flag: "", options: [""] },
      eng: { abbr: "eng", name: "resampler engine", type: "Options", min: 0, max: 0, default_value: 0, is_flag: false, flag: "", options: [""] },
      vel: { abbr: "vel", name: "velocity", type: "Curve", min: 0, max: 200, default_value: 100, is_flag: false, flag: "" },
      vol: { abbr: "vol", name: "volume", type: "Curve", min: 0, max: 200, default_value: 100, is_flag: false, flag: "" },
      atk: { abbr: "atk", name: "attack", type: "Curve", min: 0, max: 200, default_value: 100, is_flag: false, flag: "" },
      dec: { abbr: "dec", name: "decay", type: "Curve", min: 0, max: 100, default_value: 0, is_flag: false, flag: "" }
    },
    voice_parts: [
      {
        name: "Part 1",
        comment: "",
        track_no: 0,
        position: 0,
        notes: [
          { position: 1920, duration: 480, tone: 60, lyric: "I'm", phoneme_override: "" },
          { position: 2400, duration: 480, tone: 62, lyric: "still", phoneme_override: "" },
          { position: 2880, duration: 960, tone: 64, lyric: "here", phoneme_override: "" },
          { position: 4320, duration: 480, tone: 62, lyric: "wait", phoneme_override: "" },
          { position: 4800, duration: 480, tone: 62, lyric: "ing", phoneme_override: "" },
          { position: 5280, duration: 480, tone: 62, lyric: "for", phoneme_override: "" },
          { position: 5760, duration: 960, tone: 64, lyric: "you", phoneme_override: "" }
        ]
      }
    ],
    tracks: [
      {
        singer: null,
        phonemizer: "OpenUtau.Core.DiffSinger.DiffSingerBasePhonemizer",
        renderer: "DIFFSINGER",
        mute: false,
        solo: false,
        volume: 0
      }
    ],
    time_signatures: [
      { bar_position: 0, beat_per_bar: 3, beat_unit: 4 }
    ],
    tempos: [
      { position: 0, bpm: 135 }
    ]
  }
};

const TEMPLATES = [
  {
    name: 'still_here_original',
    displayName: 'Still Here (Original)',
    description: 'Original melancholic version with full orchestration'
  }
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateName = searchParams.get('name');

    // If requesting a specific template
    if (templateName) {
      const template = TEMPLATES.find(t => t.name === templateName);
      if (!template) {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }

      const templateData = TEMPLATE_DATA[templateName as keyof typeof TEMPLATE_DATA];
      if (!templateData) {
        return NextResponse.json({ error: 'Template data not found' }, { status: 404 });
      }

      return NextResponse.json({
        template,
        ustxData: templateData
      });
    }

    // Return list of all templates
    return NextResponse.json({
      templates: TEMPLATES
    });

  } catch (error) {
    console.error('Templates API error:', error);
    return NextResponse.json(
      { error: 'Failed to load templates' },
      { status: 500 }
    );
  }
}