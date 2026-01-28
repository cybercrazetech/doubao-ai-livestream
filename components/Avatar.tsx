import React, { useEffect, useRef } from 'react';

interface AvatarProps {
  emotion: string;
}

// Map emotions to colors (R, G, B)
const EMOTION_COLORS: Record<string, string> = {
  normal: '56, 189, 248',   // Light Blue
  joy: '251, 191, 36',      // Amber
  loving: '236, 72, 153',   // Pink
  playful: '16, 185, 129',  // Emerald
  anger: '239, 68, 68',     // Red
  annoyed: '249, 115, 22',  // Orange
  sadness: '99, 102, 241',  // Indigo
  shame: '139, 92, 246',    // Violet
  fear: '168, 85, 247',     // Purple
  disgust: '34, 197, 94',   // Green
  foodie: '234, 179, 8',    // Yellow
  guilt: '75, 85, 99',      // Gray
};

const Avatar: React.FC<AvatarProps> = ({ emotion }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  // Parse color based on emotion, default to Blue
  const colorBase = EMOTION_COLORS[emotion] || EMOTION_COLORS['normal'];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = canvas.width;
    let height = canvas.height;

    // Handle resizing
    const resizeObserver = new ResizeObserver(() => {
        if (canvas.parentElement) {
            canvas.width = canvas.parentElement.clientWidth;
            canvas.height = canvas.parentElement.clientHeight;
            width = canvas.width;
            height = canvas.height;
        }
    });
    resizeObserver.observe(canvas.parentElement!);

    const animate = (time: number) => {
      // Smooth time accumulation
      timeRef.current += 0.01;
      const t = timeRef.current;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; // Trails effect
      ctx.fillRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      
      // Dynamic breathing size
      const baseRadius = Math.min(width, height) * 0.15;
      const pulse = Math.sin(t * 2) * 10;
      
      // Glow settings
      ctx.shadowBlur = 50;
      ctx.shadowColor = `rgb(${colorBase})`;

      // Draw Core
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius + pulse, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colorBase}, 0.8)`;
      ctx.fill();

      // Draw Outer Rings
      ctx.lineWidth = 2;
      ctx.shadowBlur = 20;

      for (let i = 1; i <= 3; i++) {
        const ringRadius = baseRadius + pulse + (i * 30) + (Math.sin(t + i) * 10);
        const opacity = Math.max(0, 0.6 - (i * 0.15));
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${colorBase}, ${opacity})`;
        ctx.stroke();
      }

      // Draw Orbiting Particles
      ctx.shadowBlur = 10;
      const particleCount = 8;
      const orbitRadius = baseRadius * 2.5;
      
      for (let i = 0; i < particleCount; i++) {
        const angle = (t * 0.5) + (i * (Math.PI * 2 / particleCount));
        const px = centerX + Math.cos(angle) * orbitRadius;
        const py = centerY + Math.sin(angle) * (orbitRadius * 0.8); // Slight oval
        
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${colorBase}, 0.8)`;
        ctx.fill();
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(requestRef.current);
      resizeObserver.disconnect();
    };
  }, [emotion, colorBase]);

  return (
    <div className="w-full h-full bg-neutral-900 flex items-center justify-center relative overflow-hidden">
        {/* Background Gradient Mesh approximation */}
        <div 
            className="absolute inset-0 opacity-20 transition-colors duration-1000"
            style={{
                background: `radial-gradient(circle at 50% 50%, rgba(${colorBase}, 0.4) 0%, transparent 70%)`
            }}
        />
        <canvas ref={canvasRef} className="absolute inset-0 z-10 block" />
    </div>
  );
};

export default Avatar;