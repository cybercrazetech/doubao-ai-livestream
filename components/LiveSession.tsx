import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { 
  ConnectionState, 
  ChatMessage
} from '../types';
import { 
  MODEL_NAME, 
  SYSTEM_INSTRUCTION, 
  INPUT_SAMPLE_RATE, 
  OUTPUT_SAMPLE_RATE, 
  PCM_BUFFER_SIZE,
  VIDEO_FRAME_RATE,
  JPEG_QUALITY
} from '../constants';
import { decode, decodeAudioData, createPcmBlob, blobToBase64 } from '../services/audioUtils';
import AudioVisualizer from './AudioVisualizer';
import { VideoCameraIcon, VideoCameraSlashIcon, MicrophoneIcon, PhoneXMarkIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid';
import { SparklesIcon } from '@heroicons/react/24/outline';

// Custom MicrophoneSlashIcon
const MicrophoneSlashIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12.403 15.658L9.929 13.184A3.985 3.985 0 0 1 8 10V5a4 4 0 0 1 6.849-2.829l-2.446 2.446v.041A4 4 0 0 1 12.403 15.658Z" />
    <path clipRule="evenodd" fillRule="evenodd" d="M14.975 18.23L4.97 8.225l-1.195 1.196 10.606 10.605 1.195-1.195ZM12 18a5.98 5.98 0 0 0 3.714-1.285l-7.43-7.43A5.98 5.98 0 0 0 12 18Z" />
    <path clipRule="evenodd" fillRule="evenodd" d="M18.707 20.12l-1.414-1.414a6.953 6.953 0 0 0 1.207-3.706h-2a4.978 4.978 0 0 1-.84 2.64l-1.22-1.22A2.99 2.99 0 0 1 14 15.82V15h2a5 5 0 0 0 5-5v-1.172l2.122 2.122-1.415 1.414ZM4.5 5.914l1.414 1.414L3.793 9.45l1.414 1.414 2.121-2.121 1.414 1.414-2.121 2.121 1.414 1.415 2.121-2.122 1.414 1.414-2.121 2.121 1.414 1.415 2.122-2.122 1.195 1.195 1.415-1.414-14.85-14.85Z" />
  </svg>
);

// Simple chat bubble component
const ChatBubble = memo(({ message }: { message: ChatMessage }) => {
  const isUser = message.role === 'user';
  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-in fade-in slide-in-from-bottom-2`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
        isUser 
          ? 'bg-blue-600 text-white rounded-tr-sm' 
          : 'bg-neutral-800 text-neutral-200 rounded-tl-sm border border-neutral-700'
      }`}>
        {message.text}
      </div>
    </div>
  );
});

interface LiveSessionProps {
  apiKey: string;
}

const LiveSession: React.FC<LiveSessionProps> = ({ apiKey }) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Chat State
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [currentInput, setCurrentInput] = useState<string>('');
  const [currentOutput, setCurrentOutput] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const chatScrollRef = useRef<HTMLDivElement>(null);
  
  // Transcription Accumulators (Refs to access inside closure)
  const currentInputRef = useRef<string>('');
  const currentOutputRef = useRef<string>('');
  
  // Refs for cleanup
  const frameIntervalRef = useRef<number | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory, currentInput, currentOutput]);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: OUTPUT_SAMPLE_RATE
      });
    }
    return audioContextRef.current;
  }, []);

  const stopEverything = useCallback(() => {
    if (frameIntervalRef.current) {
      window.clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    sessionPromiseRef.current?.then(session => {
        try { session.close(); } catch(e) { console.warn("Session close error", e); }
    });
    sessionPromiseRef.current = null;
    
    // Clear live transcript state
    setCurrentInput('');
    setCurrentOutput('');
    currentInputRef.current = '';
    currentOutputRef.current = '';

    setConnectionState(ConnectionState.DISCONNECTED);
  }, []);

  const connectToGemini = async () => {
    if (!mediaStream) return;
    
    setErrorMsg(null);
    setConnectionState(ConnectionState.CONNECTING);
    // Clear history on new session? Optional. Let's keep it for now or clear it.
    // setChatHistory([]); 

    const ai = new GoogleGenAI({ apiKey });
    const ctx = getAudioContext();
    
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const videoEl = videoRef.current;
    const canvasEl = canvasRef.current;

    try {
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          // Enable transcription
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log("Session Opened");
            setConnectionState(ConnectionState.CONNECTED);
            
            // Audio Input Setup
            const source = ctx.createMediaStreamSource(mediaStream);
            inputSourceRef.current = source;
            const processor = ctx.createScriptProcessor(PCM_BUFFER_SIZE, 1, 1);
            scriptProcessorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (!isMicOn) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(ctx.destination);

            // Video Input Setup
            if (videoEl && canvasEl) {
                const canvasCtx = canvasEl.getContext('2d');
                const intervalMs = 1000 / VIDEO_FRAME_RATE;
                frameIntervalRef.current = window.setInterval(() => {
                    if (!isVideoOn) return;
                    if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
                        canvasEl.width = videoEl.videoWidth / 2;
                        canvasEl.height = videoEl.videoHeight / 2;
                        canvasCtx?.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
                        canvasEl.toBlob(async (blob) => {
                            if (blob) {
                                const base64Data = await blobToBase64(blob);
                                sessionPromise.then(session => {
                                    session.sendRealtimeInput({
                                        media: { mimeType: 'image/jpeg', data: base64Data }
                                    });
                                });
                            }
                        }, 'image/jpeg', JPEG_QUALITY);
                    }
                }, intervalMs);
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            // --- Audio Output Handling ---
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const ctx = getAudioContext();
                const audioData = decode(base64Audio);
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const audioBuffer = await decodeAudioData(audioData, ctx, OUTPUT_SAMPLE_RATE, 1);
                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                sourcesRef.current.add(source);
                source.onended = () => {
                    sourcesRef.current.delete(source);
                };

                // If audio starts playing, assume user turn is over. Flush user transcript if any.
                if (currentInputRef.current) {
                    const text = currentInputRef.current;
                    setChatHistory(prev => [...prev, {
                        id: Date.now().toString() + '-user',
                        role: 'user',
                        text: text,
                        timestamp: new Date()
                    }]);
                    currentInputRef.current = '';
                    setCurrentInput('');
                }
            }

            // --- Transcription Handling ---
            // 1. User Input Transcription
            if (message.serverContent?.inputTranscription?.text) {
                const text = message.serverContent.inputTranscription.text;
                currentInputRef.current += text;
                setCurrentInput(currentInputRef.current);
            }

            // 2. Model Output Transcription
            if (message.serverContent?.outputTranscription?.text) {
                const text = message.serverContent.outputTranscription.text;
                currentOutputRef.current += text;
                setCurrentOutput(currentOutputRef.current);
            }

            // 3. Turn Complete
            if (message.serverContent?.turnComplete) {
                // Flush model output
                if (currentOutputRef.current) {
                    const text = currentOutputRef.current;
                    setChatHistory(prev => [...prev, {
                        id: Date.now().toString() + '-model',
                        role: 'model',
                        text: text,
                        timestamp: new Date()
                    }]);
                    currentOutputRef.current = '';
                    setCurrentOutput('');
                }
                
                // Flush user input if it wasn't flushed by audio start (edge case)
                if (currentInputRef.current) {
                    const text = currentInputRef.current;
                    setChatHistory(prev => [...prev, {
                        id: Date.now().toString() + '-user',
                        role: 'user',
                        text: text,
                        timestamp: new Date()
                    }]);
                    currentInputRef.current = '';
                    setCurrentInput('');
                }
            }

            if (message.serverContent?.interrupted) {
                console.log("Interrupted!");
                sourcesRef.current.forEach(s => s.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                
                // If interrupted, maybe flush whatever we have?
                if (currentOutputRef.current) {
                     setChatHistory(prev => [...prev, {
                        id: Date.now().toString() + '-model-interrupted',
                        role: 'model',
                        text: currentOutputRef.current + ' ...',
                        timestamp: new Date()
                    }]);
                    currentOutputRef.current = '';
                    setCurrentOutput('');
                }
            }
          },
          onclose: () => {
            console.log("Session Closed");
            setConnectionState(ConnectionState.DISCONNECTED);
          },
          onerror: (err) => {
            console.error("Session Error", err);
            setErrorMsg("Connection error occurred.");
            setConnectionState(ConnectionState.ERROR);
            stopEverything();
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) {
        console.error(err);
        setErrorMsg(err.message || "Failed to connect");
        setConnectionState(ConnectionState.ERROR);
    }
  };

  const toggleConnection = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
        stopEverything();
    } else {
        connectToGemini();
    }
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let isMounted = true;
    const startMedia = async () => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: { echoCancellation: true, noiseSuppression: true, sampleRate: INPUT_SAMPLE_RATE }
            });
            if (!isMounted) { s.getTracks().forEach(track => track.stop()); return; }
            stream = s;
            setMediaStream(s);
        } catch (e) {
            if (isMounted) { console.error(e); setErrorMsg("Camera/Mic access denied."); }
        }
    };
    startMedia();
    return () => {
        isMounted = false;
        stopEverything();
        if (stream) { stream.getTracks().forEach(track => track.stop()); }
    };
  }, []); // eslint-disable-next-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current && mediaStream) {
        videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  useEffect(() => {
      if (mediaStream) {
          mediaStream.getAudioTracks().forEach(track => track.enabled = isMicOn);
      }
  }, [isMicOn, mediaStream]);

  const isLive = connectionState === ConnectionState.CONNECTED;

  return (
    <div className="flex flex-col lg:flex-row h-full w-full bg-black relative rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl">
      
      {/* --- Left Column: Video & Controls --- */}
      <div className="flex flex-col flex-1 relative min-h-[300px]">
        
        {/* Main Video Area */}
        <div className="relative flex-1 bg-neutral-900 flex items-center justify-center overflow-hidden group">
            {mediaStream ? (
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transition-opacity duration-500 ${isVideoOn ? 'opacity-100' : 'opacity-20 blur-lg'}`}
            />
            ) : (
            <div className="text-neutral-500 animate-pulse">Initializing Camera...</div>
            )}
            
            <canvas ref={canvasRef} className="hidden" />

            {/* Overlay Status */}
            <div className="absolute top-6 left-6 flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 z-10">
                <div className={`w-2.5 h-2.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-xs font-medium uppercase tracking-wider text-white">
                    {connectionState === ConnectionState.CONNECTED ? 'Live Agent' : 
                    connectionState === ConnectionState.CONNECTING ? 'Connecting...' : 'Offline'}
                </span>
            </div>

            {/* Error Toast */}
            {errorMsg && (
                <div className="absolute top-20 left-6 bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm max-w-xs shadow-lg backdrop-blur z-20">
                    {errorMsg}
                </div>
            )}

            {/* Disconnected State Prompt */}
            {connectionState === ConnectionState.DISCONNECTED && !errorMsg && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-md p-6 rounded-2xl border border-white/10 text-center animate-in fade-in zoom-in duration-300">
                        <SparklesIcon className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                        <h2 className="text-xl font-semibold text-white mb-1">Live Vision Assistant</h2>
                        <p className="text-neutral-400 text-sm">Connect to start a real-time multimodal call.</p>
                    </div>
                </div>
            )}
        </div>

        {/* Controls Bar */}
        <div className="h-24 bg-neutral-900/95 border-t border-white/5 flex items-center justify-between px-6 sm:px-12 backdrop-blur-lg z-20">
            <div className="flex items-center gap-4">
                <button
                    onClick={() => setIsVideoOn(!isVideoOn)}
                    className={`p-3 rounded-full transition-all duration-200 ${isVideoOn ? 'bg-neutral-800 text-white hover:bg-neutral-700' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'}`}
                    title="Toggle Camera"
                >
                    {isVideoOn ? <VideoCameraIcon className="w-6 h-6" /> : <VideoCameraSlashIcon className="w-6 h-6" />}
                </button>
                <button
                    onClick={() => setIsMicOn(!isMicOn)}
                    className={`p-3 rounded-full transition-all duration-200 ${isMicOn ? 'bg-neutral-800 text-white hover:bg-neutral-700' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'}`}
                    title="Toggle Microphone"
                >
                    {isMicOn ? <MicrophoneIcon className="w-6 h-6" /> : <MicrophoneSlashIcon className="w-6 h-6" />}
                </button>
            </div>

            <div className="flex items-center justify-center">
                {connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING ? (
                    <button
                    onClick={toggleConnection}
                    disabled={connectionState === ConnectionState.CONNECTING}
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-full font-semibold transition-all shadow-lg shadow-red-900/20 active:scale-95"
                >
                    <PhoneXMarkIcon className="w-5 h-5" />
                    <span>End Session</span>
                </button>
                ) : (
                    <button
                    onClick={toggleConnection}
                    className="group relative flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 py-3 rounded-full font-semibold transition-all shadow-lg shadow-blue-900/20 active:scale-95 overflow-hidden"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 via-white/20 to-blue-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                    <SparklesIcon className="w-5 h-5" />
                    <span>Start Live Session</span>
                </button>
                )}
            </div>

            <div className="w-32 sm:w-48 h-12 flex items-center justify-end">
                {isLive && isMicOn && (
                    <AudioVisualizer stream={mediaStream} isActive={isLive} color="#60a5fa" />
                )}
            </div>
        </div>
      </div>

      {/* --- Right Column: Chat/Transcript --- */}
      <div className="w-full lg:w-96 flex flex-col bg-neutral-900 border-l border-white/5 relative z-10">
        <div className="h-16 flex items-center px-6 border-b border-white/5 bg-neutral-900/50 backdrop-blur-md">
            <ChatBubbleLeftRightIcon className="w-5 h-5 text-neutral-400 mr-2" />
            <h3 className="font-semibold text-white">Transcript</h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatScrollRef}>
            {chatHistory.length === 0 && !currentInput && !currentOutput && (
                <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-2 opacity-50">
                    <ChatBubbleLeftRightIcon className="w-10 h-10" />
                    <p className="text-sm">Conversation history will appear here</p>
                </div>
            )}
            
            {chatHistory.map((msg) => (
                <ChatBubble key={msg.id} message={msg} />
            ))}

            {/* Partial/Live Transcripts */}
            {currentInput && (
                 <div className="flex w-full justify-end mb-4 animate-pulse opacity-75">
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 bg-blue-900/30 text-blue-200 text-sm border border-blue-800 border-dashed">
                        {currentInput} ...
                    </div>
                </div>
            )}
             {currentOutput && (
                 <div className="flex w-full justify-start mb-4 animate-pulse opacity-75">
                    <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-2.5 bg-neutral-800 text-neutral-400 text-sm border border-neutral-700 border-dashed">
                        {currentOutput} ...
                    </div>
                </div>
            )}
        </div>
      </div>

    </div>
  );
};

export default LiveSession;