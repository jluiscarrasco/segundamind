import { useState, useRef, useCallback } from 'react';

interface UseAudioRecorderReturn {
  isRecording: boolean;
  isStopped: boolean;
  duration: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string | null>; // Returns transcript
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

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

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

      // Track duration
      intervalRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error('Error starting recording:', err);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || !streamRef.current) {
        resolve(null);
        return;
      }

      const mediaRecorder = mediaRecorderRef.current;

      mediaRecorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setIsStopped(true);
        if (intervalRef.current) clearInterval(intervalRef.current);

        // Use Web Speech API for transcription
        setIsTranscribing(true);
        try {
          const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          if (!SpeechRecognition) {
            console.error('Speech Recognition not supported');
            setIsTranscribing(false);
            resolve(null);
            return;
          }

          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const audioUrl = URL.createObjectURL(blob);

          // Use a simple approach: let's try to use the API endpoint with base64
          const reader = new FileReader();
          reader.onloadend = async () => {
            try {
              const base64Audio = (reader.result as string).split(',')[1];
              const response = await fetch('/api/transcribe-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioBase64: base64Audio, mimeType: 'audio/webm' }),
              });

              const data = await response.json();
              setIsTranscribing(false);
              resolve(data.transcript || null);
            } catch (err) {
              console.error('Transcription error:', err);
              setIsTranscribing(false);
              // Fallback: return empty string
              resolve('');
            }
          };
          reader.readAsDataURL(blob);
        } catch (err) {
          console.error('Error in stopRecording:', err);
          setIsTranscribing(false);
          resolve(null);
        }
      };

      mediaRecorder.stop();
    });
  }, []);

  const resetRecording = useCallback(() => {
    setIsRecording(false);
    setIsStopped(false);
    setDuration(0);
    setIsTranscribing(false);
    chunksRef.current = [];
    if (intervalRef.current) clearInterval(intervalRef.current);
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
