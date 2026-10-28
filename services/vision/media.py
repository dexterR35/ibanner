"""Bounded timestamped media frames. Original uploads live only in browser storage."""
import base64
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from fastapi import HTTPException
from PIL import Image, ImageSequence

def media_frames(data, count=6):
    count=max(1,min(12,count))
    if len(data)>30*1024*1024:raise HTTPException(413,'Media exceeds 30 MB.')
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format in {'GIF','WEBP'}:
                if image.width*image.height>4_194_304 or getattr(image,'n_frames',1)>500 or image.width*image.height*getattr(image,'n_frames',1)>120_000_000:raise HTTPException(422,'Animated image exceeds frame/pixel limits.')
                total=getattr(image,'n_frames',1)
                chosen=set(round(i*(total-1)/max(1,min(count,total)-1)) for i in range(min(count,total)))
                duration=0;frames=[]
                for index,frame in enumerate(ImageSequence.Iterator(image)):
                    delay=max(10,int(frame.info.get('duration',100)))
                    if duration+delay>120000:raise HTTPException(422,'Media exceeds 120 seconds.')
                    # Pillow composites all disposal/blend steps; encode only selected frames.
                    if index in chosen:
                        output=io.BytesIO();frame.convert('RGBA').save(output,format='PNG')
                        frames.append({'timestampMs':duration,'durationMs':delay,'frameIndex':index,'bytes':output.getvalue()})
                    duration+=delay
                return package(image.width,image.height,duration,frames,image.format,'pillow-composited-v1')
    except HTTPException:raise
    except (OSError,ValueError):pass
    if not shutil.which('ffprobe') or not shutil.which('ffmpeg'):raise HTTPException(503,'Install local FFmpeg to sample video.')
    with tempfile.TemporaryDirectory(prefix='bannerflow-media-') as folder:
        source=Path(folder)/'source.bin';source.write_bytes(data)
        try:
            probe=subprocess.run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(source)],capture_output=True,timeout=20,check=True)
            metadata=json.loads(probe.stdout);stream=next(s for s in metadata['streams'] if s['codec_type']=='video')
            w,h=int(stream['width']),int(stream['height']);duration=float(metadata['format'].get('duration',stream.get('duration',0)))
            if w*h>4_194_304 or not 0<duration<=120:raise HTTPException(422,'Use video up to 4 megapixels and 120 seconds.')
            timing=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time,pkt_duration_time','-of','json',str(source)],capture_output=True,timeout=40,check=True)
            if len(timing.stdout)>8_000_000:raise HTTPException(422,'Video exceeds frame metadata budget.')
            frames=json.loads(timing.stdout)['frames']
            if not frames or len(frames)>30000:raise HTTPException(422,'Video frame count exceeds the budget.')
            chosen=sorted(set(round(i*(len(frames)-1)/max(1,min(count,len(frames))-1)) for i in range(min(count,len(frames)))))
            selected=[]
            for index in chosen:
                output=Path(folder)/f'{index}.png'
                subprocess.run(['ffmpeg','-v','error','-i',str(source),'-vf',f'select=eq(n\\,{index}),scale=w=1024:h=1024:force_original_aspect_ratio=decrease','-frames:v','1',str(output)],capture_output=True,timeout=40,check=True)
                frame=frames[index];selected.append({'frameIndex':index,'timestampMs':round(float(frame['best_effort_timestamp_time'])*1000),'durationMs':max(1,round(float(frame.get('pkt_duration_time',.04))*1000)),'bytes':output.read_bytes()})
            return package(w,h,round(duration*1000),selected,stream['codec_name'],'ffmpeg-frame-index-v1',hasAudio=any(s['codec_type']=='audio' for s in metadata['streams']),timeBase=stream.get('time_base'))
        except HTTPException:raise
        except (OSError,ValueError,KeyError,StopIteration,subprocess.SubprocessError) as error:raise HTTPException(422,'Media could not be decoded within its budget.') from error

def package(width,height,duration,frames,codec,method,**extra):
    for frame in frames:
        data=frame.pop('bytes');frame['sha256']=hashlib.sha256(data).hexdigest();frame['image']=base64.b64encode(data).decode()
    return {'schemaVersion':1,'width':width,'height':height,'durationMs':duration,'codec':codec,'method':method,'frames':frames,**extra}
