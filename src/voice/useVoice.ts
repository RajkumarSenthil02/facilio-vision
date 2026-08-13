/**
 * Push-to-talk via the Web Speech API (webkit-prefixed on iOS/Safari).
 * Lifted from "/Users/rajkumars/Documents/Fun projects/asset-lens/src/hooks/useVoice.ts"
 * — hand-rolled RecognitionLike typings, single-shot toggle (continuous=false,
 * interimResults=false), returns { supported, listening, toggle }.
 */
import { useEffect, useRef, useState } from 'react';

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

export function useVoice(onCommand: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported] = useState(
    () =>
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
  );
  const recRef = useRef<RecognitionLike | null>(null);
  const cbRef = useRef(onCommand);
  cbRef.current = onCommand;

  useEffect(() => {
    return () => recRef.current?.stop();
  }, []);

  const toggle = () => {
    if (!supported) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const Ctor = ((window as unknown as Record<string, unknown>).SpeechRecognition ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as new () => RecognitionLike;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript;
      if (text) cbRef.current(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  return { supported, listening, toggle };
}
