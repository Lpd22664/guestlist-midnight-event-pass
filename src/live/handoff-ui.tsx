import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, LoaderCircle, QrCode, X } from 'lucide-react';
import QRCode from 'qrcode';
import type jsQR from 'jsqr';
let decoder: Promise<typeof jsQR> | undefined;
const loadDecoder = () => decoder ??= import('jsqr').then(module => module.default);

export function PublicQr({ value, label }: { value: string; label: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let active = true; setUrl(''); void QRCode.toDataURL(value, {width:300,margin:4,errorCorrectionLevel:'M',color:{dark:'#1d1d1f',light:'#ffffff'}}).then(v=>{if(active)setUrl(v)}).catch(()=>{}); return()=>{active=false}; }, [value]);
  return <div className="public-qr">{url?<img src={url} width={300} height={300} alt={label}/>:<LoaderCircle className="spin" aria-label="Preparing public QR"/>}<span><QrCode size={14}/>Public information only</span></div>;
}
/** Camera frames and imported QR images are decoded on this device, never uploaded. */
export function PublicCodeInput({ label, onCode, disabled=false }: { label: string; onCode: (code: string) => void; disabled?: boolean }) {
  const [text,setText]=useState(''); const [error,setError]=useState(''); const [camera,setCamera]=useState(false);
  const video=useRef<HTMLVideoElement>(null); const stream=useRef<MediaStream | undefined>(undefined); const generation=useRef(0);
  function stop(){generation.current++;stream.current?.getTracks().forEach(t=>t.stop());stream.current=undefined;setCamera(false)}
  useEffect(()=>()=>{generation.current++;stream.current?.getTracks().forEach(t=>t.stop())},[]);
  useEffect(()=>{if(disabled)stop()},[disabled]);
  function accept(value:string){stop();setText('');setError('');onCode(value)}
  async function start(){
    setError(''); const token=++generation.current;
    try { const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
      if(token!==generation.current){media.getTracks().forEach(t=>t.stop());return}
      stream.current=media;setCamera(true);
    } catch {setError('Camera unavailable or permission declined. You can choose a QR image or paste its public code.');}
  }
  useEffect(()=>{if(!camera||!video.current||!stream.current)return;const node=video.current;node.srcObject=stream.current;void node.play().catch(()=>{stop();setError('Camera could not start. Choose a QR image instead.')});let frame=0;let last=0;let active=true;let decode:typeof jsQR|undefined;void loadDecoder().then(value=>{if(active)decode=value}).catch(()=>{if(active){stop();setError('QR reader could not load. Reload this page before scanning.')}});const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const scan=(at:number)=>{if(at-last>180&&node.readyState>=2&&ctx&&decode){last=at;canvas.width=Math.min(node.videoWidth,960);canvas.height=Math.round(node.videoHeight*canvas.width/node.videoWidth);ctx.drawImage(node,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const result=decode(pixels.data,pixels.width,pixels.height);if(result){accept(result.data);return}}frame=requestAnimationFrame(scan)};frame=requestAnimationFrame(scan);return()=>{active=false;cancelAnimationFrame(frame);node.srcObject=null};
  },[camera]);
  async function image(event:ChangeEvent<HTMLInputElement>){const input=event.currentTarget,file=input.files?.[0];input.value='';if(!file)return;setError('');const token=generation.current;
    try {if(file.size>8*1024*1024||!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error();const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>20000000){bitmap.close();throw new Error()}const canvas=document.createElement('canvas');canvas.width=Math.min(bitmap.width,1600);canvas.height=Math.round(bitmap.height*canvas.width/bitmap.width);const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx){bitmap.close();throw new Error()}ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const decode=await loadDecoder();const result=decode(pixels.data,pixels.width,pixels.height);if(!result)throw new Error();if(token===generation.current)accept(result.data);
    }catch{setError('No readable QR found. Use a clear PNG, JPEG or WebP image under 8 MB.');}
  }
  return <div className="public-code-input"><div className="scan-actions"><button className="button primary" type="button" disabled={disabled||camera} onClick={()=>void start()}><Camera size={18}/>Scan {label}</button><label className="button secondary qr-image-picker">Choose QR image<input type="file" aria-label={`Choose ${label} QR image`} accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={image}/></label></div>{camera&&<div className="camera-preview"><video ref={video} muted playsInline aria-label="Local QR camera preview"/><button className="button secondary" type="button" onClick={stop}><X size={16}/>Stop camera</button></div>}<details className="technical-note"><summary>Paste public code instead</summary><label className="form-field">{label}<textarea aria-label={label} value={text} maxLength={8192} disabled={disabled} onChange={e=>setText(e.target.value)} placeholder="Public Guestlist QR data or event link"/></label><button className="button secondary" type="button" disabled={disabled||!text.trim()} onClick={()=>accept(text.trim())}>Read public code</button></details><small>Only use public Guestlist codes here. Private recovery files belong in Unlock.</small>{error&&<p className="form-error" role="alert">{error}</p>}</div>;
}
