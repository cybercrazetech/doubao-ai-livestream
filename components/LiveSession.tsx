import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { GoogleGenAI } from '@google/genai';
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
import Avatar from './Avatar';
import { VideoCameraIcon, VideoCameraSlashIcon, MicrophoneIcon, PhoneXMarkIcon, ChatBubbleLeftRightIcon, BugAntIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/solid';
import { SparklesIcon } from '@heroicons/react/24/outline';

// Available emotion mp4s based on user file availability
const AVAILABLE_EMOTIONS = ['normal', 'anger', 'annoyed'];
// USING DIRECT RAW DOMAIN TO FIX CORS ISSUES
const VIDEO_BASE_URL = 'https://raw.githubusercontent.com/cybercrazetech/doubao-ai-livestream/main/emotions';

// Tool definition for emotion changing
const emotionTool: FunctionDeclaration = {
  name: "set_emotion",
  description: "Update the facial expression of the AI avatar based on the conversation context.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      emotion: {
        type: Type.STRING,
        description: "The emotion to display.",
        enum: ["normal", "anger", "annoyed", "disgust", "fear", "foodie", "guilt", "joy", "loving", "playful", "sadness", "shame"]
      }
    },
    required: ["emotion"]
  }
};

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
  const [currentEmotion, setCurrentEmotion] = useState<string>('normal');
  const [videoFit, setVideoFit] = useState<'cover' | 'contain'>('contain');

  // Debug State
  const [showDebug, setShowDebug] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [httpDebugInfo, setHttpDebugInfo] = useState<string>('Checking...');
  const [videoLoadError, setVideoLoadError] = useState(false);

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
  
  // Transcription Accumulators
  const currentInputRef = useRef<string>('');
  const currentOutputRef = useRef<string>('');
  
  // Refs for cleanup
  const frameIntervalRef = useRef<number | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [`[${new Date().toLocaleTimeString().split(' ')[0]}] ${msg}`, ...prev].slice(0, 25));
  }, []);

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
    addLog("Stopping session...");
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
  }, [addLog]);

  const connectToGemini = async () => {
    if (!mediaStream) {
        addLog("Error: No media stream found");
        return;
    }
    
    setErrorMsg(null);
    setConnectionState(ConnectionState.CONNECTING);
    addLog("Connecting to Gemini...");

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
          tools: [{ functionDeclarations: [emotionTool] }],
        },
        callbacks: {
          onopen: () => {
            addLog("Session Connected");
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
            // --- Tool Calls (Emotion) ---
            if (message.toolCall) {
              const responses = [];
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'set_emotion') {
                  const args = fc.args as any;
                  addLog(`Tool: set_emotion(${args.emotion})`);
                  setCurrentEmotion(args.emotion);
                  responses.push({
                    id: fc.id,
                    name: fc.name,
                    response: { result: 'success' }
                  });
                }
              }
              if (responses.length > 0) {
                 sessionPromise.then(session => session.sendToolResponse({ functionResponses: responses }));
              }
            }

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
                addLog("Model interrupted");
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
            addLog("Session Closed");
            setConnectionState(ConnectionState.DISCONNECTED);
          },
          onerror: (err) => {
            addLog("Session Error: " + err.message);
            console.error("Session Error", err);
            setErrorMsg("Connection error occurred.");
            setConnectionState(ConnectionState.ERROR);
            stopEverything();
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) {
        addLog("Init Error: " + err.message);
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
    addLog("Initializing media...");
    const startMedia = async () => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: { echoCancellation: true, noiseSuppression: true, sampleRate: INPUT_SAMPLE_RATE }
            });
            if (!isMounted) { s.getTracks().forEach(track => track.stop()); return; }
            stream = s;
            setMediaStream(s);
            addLog("Media initialized");
        } catch (e: any) {
            if (isMounted) { 
                console.error(e); 
                addLog("Media Access Error: " + e.message);
                setErrorMsg("Camera/Mic access denied."); 
            }
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

  // --- Audit Script on Mount ---
  useEffect(() => {
    const runAudit = async () => {
        addLog("[System] Check GitHub Video Refs...");
        
        const checks = AVAILABLE_EMOTIONS.map(async (emotion) => {
            const path = `${VIDEO_BASE_URL}/${emotion}.mp4`;
            try {
                // Add a timeout to the fetch to prevent hanging
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);
                
                const resp = await fetch(path, { 
                    method: 'GET', // Use GET instead of HEAD for better compatibility with raw.githubusercontent.com
                    headers: { 'Range': 'bytes=0-0' }, // Request just the first byte
                    signal: controller.signal 
                });
                clearTimeout(timeoutId);
                
                if (resp.ok || resp.status === 206) {
                    return `✅ ${emotion} - OK`;
                } else {
                    return `❌ ${emotion} - FAILED (${resp.status})`;
                }
            } catch (e: any) {
                if (e.name === 'AbortError') {
                    return `❌ ${emotion} - TIMEOUT`;
                }
                 // If fetch fails (CORS), we just log it but don't panic, video tag might still work
                return `⚠️ ${emotion} - Fetch Check Failed (Video might still work)`;
            }
        });

        const results = await Promise.all(checks);
        results.forEach(r => addLog(r));
    };
    
    // slight delay to ensure logs are visible after component mount
    setTimeout(runAudit, 1000);
  }, [addLog]);

  const isLive = connectionState === ConnectionState.CONNECTED;

  // Resolve video source based on availability
  // Using absolute paths ensures the browser looks at the root public folder
  const getEmotionVideoSrc = (emotion: string) => {
      if (AVAILABLE_EMOTIONS.includes(emotion)) {
          return `${VIDEO_BASE_URL}/${emotion}.mp4`;
      }
      return `${VIDEO_BASE_URL}/normal.mp4`;
  };

  const videoSrc = getEmotionVideoSrc(currentEmotion);

  // --- HTTP Pre-check for Video Debugging ---
  useEffect(() => {
    setVideoLoadError(false); // Reset error when src changes
    const checkUrl = async () => {
      const url = videoSrc;
      setHttpDebugInfo(`Checking ${url}...`);
      try {
        // Just a light check
        const response = await fetch(url, { 
            method: 'GET',
            headers: { 'Range': 'bytes=0-0' }
        });
        
        const info = `HTTP ${response.status} ${response.statusText}`;
        setHttpDebugInfo(info);
        
        if (!response.ok && response.status !== 206) {
           addLog(`VIDEO FETCH ERR: ${response.status}`);
           // Don't force error state, let video tag try
        } else {
           addLog(`Video Pre-check OK for ${currentEmotion}`);
        }

      } catch (e: any) {
        setHttpDebugInfo(`Fetch Failed: ${e.message}`);
        // Likely CORS restriction on fetch API, but video tag might work.
        // We do NOT setVideoLoadError(true) here anymore, to allow the video tag to attempt loading.
      }
    };
    checkUrl();
  }, [videoSrc, addLog, currentEmotion]);


  // --- Detailed Video Debugging Handlers ---
  const handleLoadStart = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
      // setVideoError(null); 
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
      const el = e.currentTarget;
      addLog(`Metadata loaded: ${el.videoWidth}x${el.videoHeight}, Dur: ${el.duration}s`);
  };

  const handleCanPlay = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
      addLog(`Video can play: ${currentEmotion}`);
      setVideoError(null); 
      setVideoLoadError(false);
  };

  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
      const el = e.currentTarget;
      const error = el.error;
      const networkState = el.networkState;
      const readyState = el.readyState;
      
      let msg = 'Unknown error';
      if (error) {
          if (error.code === 4 && networkState === 3) {
             msg = "Format Error (Likely missing file or wrong path)";
          } else {
             msg = `Code ${error.code}: ${error.message}`;
          }
      }
      
      const debugDetails = `Err: ${msg} | NS: ${networkState} | RS: ${readyState}`;
      
      // Only set error state if it's a real failure, NOT just CORS noise if the video was actually playing
      // Since we removed crossOrigin="anonymous", CORS errors on the video tag itself shouldn't happen unless the resource is 404.
      
      console.warn("Video Playback Error:", debugDetails);
      setVideoError(debugDetails);
      addLog(debugDetails);
      
      // Fallback to avatar if video fails
      setVideoLoadError(true);
  };

  return (
    <div className="flex flex-col lg:flex-row h-full w-full bg-black relative rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl">
      
      {/* --- Left Column: Video & Controls --- */}
      <div className="flex flex-col flex-1 relative min-h-0 overflow-hidden">
        
        {/* Main Display Area */}
        <div className="relative flex-1 bg-neutral-900 flex items-center justify-center overflow-hidden group min-h-0">
            
            {/* 1. Bot Video (Background layer) - Always visible */}
            <div className="absolute inset-0 w-full h-full z-0 flex items-center justify-center bg-black">
               {videoLoadError ? (
                   // Fallback Avatar if Video Fails
                   <div className={`w-full h-full transition-opacity duration-700 ${isLive ? 'opacity-100' : 'opacity-60 grayscale'}`}>
                       <Avatar emotion={currentEmotion} />
                       {/* Overlay info about error */}
                       {showDebug && <div className="absolute bottom-2 left-2 text-red-500 text-xs bg-black/50 p-1">Using Fallback Avatar (Video Missing)</div>}
                   </div>
               ) : (
                   <video 
                      key={videoSrc} // Force re-render when source changes
                      src={videoSrc}
                      // Removed crossOrigin="anonymous" to fix CORS issues on GitHub Raw files
                      autoPlay loop muted playsInline
                      className={`max-w-full max-h-full transition-opacity duration-700 ${isLive ? 'opacity-100' : 'opacity-60 grayscale'} ${videoFit === 'cover' ? 'w-full h-full object-cover' : 'w-full h-full object-contain'}`}
                      onLoadStart={handleLoadStart}
                      onLoadedMetadata={handleLoadedMetadata}
                      onCanPlay={handleCanPlay}
                      onError={handleVideoError}
                   />
               )}
               
               {!isLive && (
                   <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" /> 
               )}
            </div>

            {/* Scale Toggle (Fit/Cover) */}
            <div className="absolute top-4 left-4 z-50">
                 <button 
                    onClick={() => setVideoFit(videoFit === 'cover' ? 'contain' : 'cover')}
                    className="p-2 rounded-full backdrop-blur-md bg-black/40 text-neutral-400 border border-white/10 hover:bg-black/60 hover:text-white transition-colors"
                    title={videoFit === 'cover' ? 'Fit Video' : 'Fill Screen'}
                >
                    {videoFit === 'cover' ? <ArrowsPointingInIcon className="w-5 h-5" /> : <ArrowsPointingOutIcon className="w-5 h-5" />}
                </button>
            </div>

            {/* Debug Toggle */}
            <div className="absolute top-4 right-4 z-50">
                <button 
                    onClick={() => setShowDebug(!showDebug)}
                    className={`p-2 rounded-full backdrop-blur-md border transition-colors ${showDebug ? 'bg-white text-black border-white' : 'bg-black/40 text-neutral-400 border-white/10 hover:bg-black/60'}`}
                >
                    <BugAntIcon className="w-5 h-5" />
                </button>
            </div>

            {/* Debug Panel */}
            {showDebug && (
                <div className="absolute bottom-24 left-4 right-4 sm:right-auto sm:w-96 max-h-80 bg-black/90 backdrop-blur-md border border-white/10 rounded-xl p-4 overflow-y-auto z-40 text-xs font-mono text-neutral-300 shadow-2xl">
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                        <span className="font-bold text-white">Debug Info</span>
                        <button onClick={() => setLogs([])} className="text-neutral-500 hover:text-white">Clear</button>
                    </div>
                    
                    <div className="space-y-1 mb-3">
                        <div className="flex justify-between">
                            <span>Status:</span>
                            <span className={connectionState === ConnectionState.CONNECTED ? 'text-green-400' : 'text-yellow-400'}>{connectionState}</span>
                        </div>
                         <div className="flex justify-between">
                            <span>Emotion:</span>
                            <span className="text-blue-400">{currentEmotion}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Video Src:</span>
                            <span className="text-neutral-400 truncate max-w-[150px]">{videoSrc}</span>
                        </div>
                        <div className="flex flex-col mt-1 p-2 bg-neutral-800 rounded">
                            <span className="text-neutral-500 font-bold mb-1">Pre-flight Check:</span>
                            <span className="text-white break-all">{httpDebugInfo}</span>
                        </div>
                        {videoError && (
                             <div className="text-red-400 font-bold mt-1 break-words bg-red-900/20 p-2 rounded">
                                {videoError}
                            </div>
                        )}
                    </div>

                    <div className="space-y-1 border-t border-white/5 pt-2">
                        {logs.length === 0 && <span className="text-neutral-600 italic">No logs yet...</span>}
                        {logs.map((log, i) => (
                            <div key={i} className="break-all border-b border-white/5 pb-1 mb-1">{log}</div>
                        ))}
                    </div>
                </div>
            )}


            {/* 2. User Video (PiP) - Always on top, bottom right */}
             <div className={`
                absolute bottom-4 right-4 z-30
                transition-all duration-500 ease-in-out
                ${isLive ? 'w-24 sm:w-48' : 'w-32 sm:w-64'} 
                aspect-[4/3] rounded-xl overflow-hidden 
                border border-white/20 shadow-2xl bg-black
            `}>
                {mediaStream ? (
                    <video
                        ref={videoRef}
                        autoPlay playsInline muted
                        className={`w-full h-full object-cover transform scale-x-[-1] ${isVideoOn ? 'opacity-100' : 'opacity-0'}`}
                    />
                ) : (
                     <div className="w-full h-full flex items-center justify-center text-neutral-500">
                        <VideoCameraIcon className="w-8 h-8 opacity-50 animate-pulse" />
                     </div>
                )}
                 {!isVideoOn && (
                    <div className="absolute inset-0 flex items-center justify-center bg-neutral-800/80 backdrop-blur-sm">
                        <VideoCameraSlashIcon className="w-8 h-8 text-neutral-500" />
                    </div>
                )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {/* Overlay Status */}
            {!showDebug && (
                 <div className="absolute top-6 left-6 flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 z-40">
                    <div className={`w-2.5 h-2.5 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="hidden sm:inline text-xs font-medium uppercase tracking-wider text-white">
                        {connectionState === ConnectionState.CONNECTED ? 'Live Agent' : 
                        connectionState === ConnectionState.CONNECTING ? 'Connecting...' : 'Offline'}
                    </span>
                </div>
            )}

            {/* Error Toast */}
            {errorMsg && (
                <div className="absolute top-20 left-6 bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm max-w-xs shadow-lg backdrop-blur z-50">
                    {errorMsg}
                </div>
            )}

            {/* Disconnected State Prompt */}
            {connectionState === ConnectionState.DISCONNECTED && !errorMsg && (
                <div className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-md p-6 rounded-2xl border border-white/10 text-center animate-in fade-in zoom-in duration-300 mx-4">
                        <SparklesIcon className="w-12 h-12 text-blue-400 mx-auto mb-3" />
                        <h2 className="text-xl font-semibold text-white mb-1">Live Vision Assistant</h2>
                        <p className="text-neutral-400 text-sm">Connect to start a real-time multimodal call.</p>
                    </div>
                </div>
            )}
        </div>

        {/* Controls Bar */}
        <div className="flex-none h-20 sm:h-24 bg-neutral-900/95 border-t border-white/5 flex items-center justify-between px-4 sm:px-12 backdrop-blur-lg z-20">
            <div className="flex items-center gap-2 sm:gap-4">
                <button
                    onClick={() => setIsVideoOn(!isVideoOn)}
                    className={`p-2 sm:p-3 rounded-full transition-all duration-200 ${isVideoOn ? 'bg-neutral-800 text-white hover:bg-neutral-700' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'}`}
                    title="Toggle Camera"
                >
                    {isVideoOn ? <VideoCameraIcon className="w-5 h-5 sm:w-6 sm:h-6" /> : <VideoCameraSlashIcon className="w-5 h-5 sm:w-6 sm:h-6" />}
                </button>
                <button
                    onClick={() => setIsMicOn(!isMicOn)}
                    className={`p-2 sm:p-3 rounded-full transition-all duration-200 ${isMicOn ? 'bg-neutral-800 text-white hover:bg-neutral-700' : 'bg-red-500/20 text-red-500 hover:bg-red-500/30'}`}
                    title="Toggle Microphone"
                >
                    {isMicOn ? <MicrophoneIcon className="w-5 h-5 sm:w-6 sm:h-6" /> : <MicrophoneSlashIcon className="w-5 h-5 sm:w-6 sm:h-6" />}
                </button>
            </div>

            <div className="flex items-center justify-center">
                {connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING ? (
                    <button
                    onClick={toggleConnection}
                    disabled={connectionState === ConnectionState.CONNECTING}
                    className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 sm:px-8 py-2 sm:py-3 rounded-full font-semibold transition-all shadow-lg shadow-red-900/20 active:scale-95 text-sm sm:text-base"
                >
                    <PhoneXMarkIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">End Session</span>
                    <span className="sm:hidden">End</span>
                </button>
                ) : (
                    <button
                    onClick={toggleConnection}
                    className="group relative flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 sm:px-8 py-2 sm:py-3 rounded-full font-semibold transition-all shadow-lg shadow-blue-900/20 active:scale-95 overflow-hidden text-sm sm:text-base"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 via-white/20 to-blue-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                    <SparklesIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden sm:inline">Start Live Session</span>
                    <span className="sm:hidden">Start</span>
                </button>
                )}
            </div>

            <div className="w-20 sm:w-48 h-12 flex items-center justify-end">
                {isLive && isMicOn && (
                    <AudioVisualizer stream={mediaStream} isActive={isLive} color="#60a5fa" />
                )}
            </div>
        </div>
      </div>

      {/* --- Right Column: Chat/Transcript --- */}
      {/* Mobile: Fixed height 40% (or flex-1 if we prefer). Desktop: Full height, fixed width */}
      <div className="h-[40%] lg:h-full lg:w-96 flex-none lg:flex-auto flex flex-col bg-neutral-900 border-t lg:border-t-0 lg:border-l border-white/5 relative z-10 min-h-0">
        <div className="flex-none h-12 sm:h-16 flex items-center px-4 sm:px-6 border-b border-white/5 bg-neutral-900/50 backdrop-blur-md">
            <ChatBubbleLeftRightIcon className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-400 mr-2" />
            <h3 className="font-semibold text-white text-sm sm:text-base">Transcript</h3>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatScrollRef}>
            {chatHistory.length === 0 && !currentInput && !currentOutput && (
                <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-2 opacity-50">
                    <ChatBubbleLeftRightIcon className="w-8 h-8 sm:w-10 sm:h-10" />
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