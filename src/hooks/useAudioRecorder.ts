import { useState, useRef, useCallback, useEffect } from 'react';

interface UseAudioRecorderReturn {
  isRecording: boolean;
  isStopped: boolean;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string>;
  resetRecording: () => void;
  isTranscribing: boolean;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef('');

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'es-ES';
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      transcriptRef.current = '';
      console.log('✅ Recording started, stream obtained');

      // Start speech recognition in parallel
      if (recognitionRef.current) {
        console.log('✅ Web Speech API available, starting recognition');
        recognitionRef.current.onresult = (event: any) => {
          console.log('🎤 Speech result event:', event.results.length, 'results');
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              const text = event.results[i][0].transcript;
              transcriptRef.current += text + ' ';
              console.log('📝 Transcript updated:', transcriptRef.current);
            }
          }
        };
        recognitionRef.current.onerror = (event: any) => {
          console.error('❌ Speech recognition error:', event.error);
        };
        recognitionRef.current.start();
      } else {
        console.warn('⚠️ Web Speech API not available');
      }

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setIsStopped(false);
      setDuration(0);

      intervalRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error('Error starting recording:', err);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || !streamRef.current) {
        console.log('❌ No recorder or stream');
        resolve('');
        return;
      }

      const mediaRecorder = mediaRecorderRef.current;

      mediaRecorder.onstop = () => {
        console.log('⏹️ Recording stopped');
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setIsStopped(true);
        if (intervalRef.current) clearInterval(intervalRef.current);

        // Stop speech recognition
        if (recognitionRef.current) {
          console.log('🛑 Stopping speech recognition');
          recognitionRef.current.stop();
        }

        // Return accumulated transcript
        const finalTranscript = transcriptRef.current.trim();
        console.log('✅ Final transcript:', finalTranscript);
        setIsTranscribing(false);
        resolve(finalTranscript);
      };

      console.log('⏹️ Calling mediaRecorder.stop()');
      mediaRecorder.stop();
    });
  }, []);

  const resetRecording = useCallback(() => {
    setIsRecording(false);
    setIsStopped(false);
    setDuration(0);
    setIsTranscribing(false);
    chunksRef.current = [];
    transcriptRef.current = '';
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  return {
    isRecording,
    isStopped,
    duration,
    startRecording,
    stopRecording,
    resetRecording,
    isTranscribing,
  };
}
