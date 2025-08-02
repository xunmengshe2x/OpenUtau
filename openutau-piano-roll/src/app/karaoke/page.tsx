import KaraokeVideoGenerator from '@/components/KaraokeVideoGenerator';

export default function KaraokePage() {
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            🎤 AI Singer Karaoke Video Generator
          </h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Transform your AI singing projects into shareable karaoke videos with lip sync animation and lyrics display.
            Upload your USTX file, choose a singer, and let our system create an awesome video you can share with friends!
          </p>
        </div>
        
        <KaraokeVideoGenerator />
        
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            🚀 Powered by OpenUtau, Rhubarb Lip Sync, and SkiaSharp 
          </p>
        </div>
      </div>
    </div>
  );
}