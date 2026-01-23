import React, { useEffect, useRef } from 'react';
import { AudioVisualizerProps } from '../types';

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ stream, isActive, color = '#3b82f6' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const analyserRef = useRef<AnalyserNode>();
  const audioContextRef = useRef<AudioContext>();
  const sourceRef = useRef<MediaStreamAudioSourceNode>();

  useEffect(() => {
    if (!stream || !isActive || !canvasRef.current) return;

    // Initialize Audio Context for visualization if not already done
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    const ctx = audioContextRef.current;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64; // Low resolution for bars
    analyserRef.current = analyser;

    try {
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        sourceRef.current = source;
    } catch (e) {
        console.error("Error creating media stream source for visualizer:", e);
        return;
    }

    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isActive) return;
      
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      if (!canvasCtx) return;

      canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2; // Scale down
        
        // Dynamic color/opacity based on volume
        const opacity = Math.min(1, barHeight / 100 + 0.3);
        
        canvasCtx.fillStyle = color;
        canvasCtx.globalAlpha = opacity;
        
        // Draw rounded bars centered vertically
        const y = (canvas.height - barHeight) / 2;
        
        canvasCtx.beginPath();
        canvasCtx.roundRect(x, y, barWidth - 2, barHeight, 4);
        canvasCtx.fill();

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      sourceRef.current?.disconnect();
      // We don't close the context here as it might be reused or owned by parent, 
      // but in this specific component scope, we just disconnect nodes.
    };
  }, [stream, isActive, color]);

  if (!isActive) return <div className="h-12 w-32" />;

  return (
    <canvas 
      ref={canvasRef} 
      width={160} 
      height={48} 
      className="w-full h-full"
    />
  );
};

export default AudioVisualizer;
