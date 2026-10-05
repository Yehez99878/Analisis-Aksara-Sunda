import { useState, useRef, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { generatePDF } from './lib/pdf';
import type { RecognitionResult } from './lib/model';
import { Search, FileImage, Upload, ClipboardPaste, Download, Trash2, CheckCircle2, XCircle } from 'lucide-react';

function App() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [recognizedResult, setRecognizedResult] = useState<RecognitionResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.signInAnonymously().catch(console.error);
  }, []);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      showError('Hanya file gambar yang didukung');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setSelectedImage(e.target?.result as string);
      setRecognizedResult(null);
      setError('');
      setSuccess('');
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handlePaste = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.some(t => t.startsWith('image/'))) {
          const type = item.types.find(t => t.startsWith('image/'))!;
          const blob = await item.getType(type);
          handleFile(new File([blob], 'pasted-image.png', { type }));
          return;
        }
      }
      showError('Tidak ada gambar di clipboard');
    } catch (e: any) {
      showError('Gagal mengakses clipboard: ' + e.message);
    }
  };

  const processImage = async () => {
    if (!selectedImage) return;

    setIsProcessing(true);
    setStatusText('Mengirim ke server pengenalan...');
    setError('');
    setSuccess('');

    try {
      const match = selectedImage.match(/^data:(image\/[a-z+.-]+);base64,(.*)$/i);
      if (!match) throw new Error('Format gambar tidak valid');

      const mediaType = match[1];
      const base64 = match[2];

      // Panggil Supabase Edge Function (API Key AMAN di server, tidak terekspos)
      const { data, error: fnError } = await supabase.functions.invoke('ocr-aksara', {
        body: { image: { base64, mediaType } }
      });

      // Tangkap error detail dari Edge Function
      if (fnError) {
        // Coba baca pesan error dari response body
        const errMsg = data?.error || fnError.message || 'Gagal memanggil fungsi OCR';
        throw new Error(errMsg);
      }
      if (data?.error) throw new Error(data.error);

      setRecognizedResult(data as RecognitionResult);

      // Phase 2: Simpan gambar dan hasil ke Supabase Storage & Database
      setStatusText('Menyimpan riwayat...');
      const user = (await supabase.auth.getUser()).data.user;

      const fileName = `${Date.now()}.jpg`;
      const byteCharacters = atob(base64);
      const byteArrays = [];
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers));
      }
      const blob = new Blob(byteArrays, { type: mediaType });

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('aksara-images')
        .upload(`${user?.id || 'anon'}/${fileName}`, blob);

      if (!uploadError && uploadData) {
        await supabase.from('ocr_results').insert({
          user_id: user?.id,
          image_path: uploadData.path,
          result_json: data
        });
      }

      showSuccess('Pengenalan berhasil!');
    } catch (e: any) {
      showError('Error: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(''), 7000);
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(''), 5000);
  };

  const handleClear = () => {
    setSelectedImage(null);
    setRecognizedResult(null);
    setError('');
    setSuccess('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-full max-w-4xl p-4 sm:p-6 mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 text-theme-gold mb-2">
          <Search size={32} />
          <h1 className="text-2xl sm:text-3xl font-bold">Aksara Sunda OCR</h1>
        </div>
        <h2 className="text-lg sm:text-xl text-white mb-1">Pengenalan Aksara dengan AI</h2>
        <p className="text-theme-muted text-sm sm:text-base">
          Unggah gambar aksara Sunda dan biarkan AI mengenalinya secara otomatis
        </p>
      </div>

      <div className="glass-card rounded-2xl p-4 sm:p-6 relative text-gray-800">
        {!selectedImage ? (
          <div
            className={`upload-area-dashed rounded-xl p-8 sm:p-12 text-center cursor-pointer flex flex-col items-center gap-4 ${isDragOver ? 'dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileImage size={48} className="text-theme-gold" />
            <div>
              <p className="text-lg font-semibold mb-1">Pilih atau Seret Gambar Aksara Sunda</p>
              <p className="text-sm text-gray-500">Dukung format: JPG, PNG, WebP</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mt-4 w-full justify-center">
              <button className="px-6 py-2.5 bg-theme-gold text-black font-semibold rounded-lg hover:bg-yellow-400 transition-colors flex items-center justify-center gap-2">
                <Upload size={18} />
                Pilih Gambar
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handlePaste(); }}
                className="px-6 py-2.5 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
              >
                <ClipboardPaste size={18} />
                Tempel Clipboard
              </button>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                  <FileImage size={18} />
                  Gambar Asli
                </h3>
                <div className="bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center min-h-[200px]">
                  <img src={selectedImage} alt="Preview" className="max-h-[400px] w-auto object-contain" />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                  <Search size={18} />
                  Hasil Pengenalan
                </h3>
                <div className="bg-gray-100 rounded-xl p-4 min-h-[200px] h-full overflow-y-auto max-h-[400px]">
                  {isProcessing ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
                      <div className="spinner !my-0"></div>
                      <p>{statusText}</p>
                    </div>
                  ) : recognizedResult ? (
                    <div className="space-y-4">
                      {recognizedResult.transkripsi && (
                        <div>
                          <h4 className="font-bold text-gray-800 text-sm mb-1">Transkripsi:</h4>
                          <p className="text-gray-700 whitespace-pre-wrap">{recognizedResult.transkripsi}</p>
                        </div>
                      )}
                      {recognizedResult.aksaraTerdeteksi?.length > 0 && (
                        <div>
                          <h4 className="font-bold text-gray-800 text-sm mb-1">Aksara Terdeteksi:</h4>
                          <ul className="list-disc pl-5 text-gray-700 text-sm">
                            {recognizedResult.aksaraTerdeteksi.map((a, i) => (
                              <li key={i}>
                                <span className="font-mono bg-gray-200 px-1 rounded">{a.aksara}</span> - {a.latin} <span className="text-xs text-gray-500">({(a.confidence * 100).toFixed(0)}%)</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {recognizedResult.catatan && (
                        <div>
                          <h4 className="font-bold text-gray-800 text-sm mb-1">Catatan:</h4>
                          <p className="text-gray-700 text-sm">{recognizedResult.catatan}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      Siap untuk diproses...
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={processImage}
                disabled={isProcessing}
                className="flex-1 min-w-[150px] px-6 py-3 bg-theme-gold text-black font-semibold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Search size={18} />
                Jalankan OCR
              </button>
              <button
                onClick={() => recognizedResult && generatePDF(recognizedResult)}
                disabled={isProcessing || !recognizedResult}
                className="flex-1 min-w-[150px] px-6 py-3 bg-[#4CAF50] text-white font-semibold rounded-lg hover:bg-[#45a049] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Download size={18} />
                Unduh PDF
              </button>
              <button
                onClick={handleClear}
                disabled={isProcessing}
                className="px-6 py-3 bg-[#f44336] text-white font-semibold rounded-lg hover:bg-[#da190b] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Trash2 size={18} />
                Bersihkan
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute top-4 left-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg flex items-start gap-2 shadow-lg z-50">
            <XCircle size={20} className="shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {success && (
          <div className="absolute top-4 left-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2 shadow-lg z-50">
            <CheckCircle2 size={20} className="shrink-0" />
            <span className="text-sm">{success}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
