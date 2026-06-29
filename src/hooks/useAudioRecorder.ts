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

        // Use Web Speech API for transcription (runs in browser, no server needed)
        setIsTranscribing(true);
        try {
          const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

          if (!SpeechRecognition) {
            console.log('Speech Recognition not supported, returning empty');
            setIsTranscribing(false);
            resolve('');
            return;
          }

          const blob = new Blob(chunksRef.current, { type: 'audio/wav' });
          const audioUrl = URL.createObjectURL(blob);

          // Create audio element and let Web Speech API process it
          const audio = new Audio(audioUrl);

          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'es-ES';

          let transcript = '';

          recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
              transcript += event.results[i][0].transcript;
            }
          };

          recognition.onerror = (event: any) => {
            console.error('Speech recognition error:', event.error);
            setIsTranscribing(false);
            resolve(transcript || '');
          };

          recognition.onend = () => {
            setIsTranscribing(false);
            resolve(transcript || '');
          };

          // Start recognition
          audio.onended = () => {
            recognition.stop();
          };

          recognition.start();
          audio.play();
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
