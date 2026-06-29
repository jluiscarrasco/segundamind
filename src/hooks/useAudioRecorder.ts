import { useState, useRef, useCallback } from 'react';

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
  // All states declared at the top - consistent order
  const [isRecording, setIsRecording] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // All refs declared after states
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

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
        resolve('');
        return;
      }

      const mediaRecorder = mediaRecorderRef.current;

      mediaRecorder.onstop = async () => {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setIsStopped(true);
        if (intervalRef.current) clearInterval(intervalRef.current);

        // Transcribe using server endpoint
        setIsTranscribing(true);
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/wav' });
          const reader = new FileReader();

          reader.onloadend = async () => {
            try {
              const base64Audio = (reader.result as string).split(',')[1];
              const response = await fetch('/api/transcribe-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audioBase64: base64Audio, mimeType: 'audio/wav' }),
              });

              if (!response.ok) {
                throw new Error(`Transcription failed: ${response.statusText}`);
              }

              const data = await response.json();
              setIsTranscribing(false);
              resolve(data.transcript || '');
            } catch (err) {
              console.error('Transcription error:', err);
              setIsTranscribing(false);
              resolve('');
            }
          };

          reader.readAsDataURL(blob);
        } catch (err) {
          console.error('Error in stopRecording:', err);
          setIsTranscribing(false);
          resolve('');
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
