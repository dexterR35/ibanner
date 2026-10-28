import asyncio
import io
from fastapi import HTTPException, Query, Request
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from .image_tools import ImageTools

def install_tool_routes(app, sam, tools=None, scheduler=None):
    tools = tools or ImageTools(sam)
    if scheduler and hasattr(tools, 'unload'):
        scheduler.register('tools', tools.unload)
    async def execute(request,operation,*args,precision=False):
        # Cut-out hands CPU masks from SAM to BiRefNet, unloading SAM between stages.
        return await scheduler.submit('sam' if precision else 'tools',operation,*args,request=request) if scheduler else await asyncio.to_thread(operation,*args)
    async def source(request):
        if request.headers.get('content-type','').split(';')[0] not in {'image/png','image/jpeg','image/webp'}:
            raise HTTPException(415,'Use PNG, JPEG or WebP.')
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>30*1024*1024:raise HTTPException(413,'Image exceeds 30 MB.')
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {'PNG','JPEG','WEBP'} or image.width*image.height>40_000_000:raise ValueError()
                return ImageOps.exif_transpose(image).copy()
        except (OSError,ValueError,UnidentifiedImageError,Image.DecompressionBombError):raise HTTPException(422,'Invalid source image.')
    def png(image,engine,box=None):
        buffer=io.BytesIO();image.save(buffer,format='PNG')
        headers={'X-Bannerflow-Engine':engine}
        if box is not None:headers['X-Bannerflow-Box']=','.join(f'{v:.6f}' for v in box)
        return Response(buffer.getvalue(),media_type='image/png',headers=headers)
    @app.get('/tools/health')
    async def health():return await asyncio.to_thread(tools.health)
    @app.post('/tools/cutout')
    async def cutout(request:Request,label:str=Query(default='foreground',max_length=160),xmin:float|None=Query(default=None,ge=0,le=1),ymin:float|None=Query(default=None,ge=0,le=1),xmax:float|None=Query(default=None,ge=0,le=1),ymax:float|None=Query(default=None,ge=0,le=1),precision:bool=False):
        box=[xmin,ymin,xmax,ymax]
        if any(v is not None for v in box):
            if any(v is None for v in box) or xmin>=xmax or ymin>=ymax:raise HTTPException(422,'Invalid subject box.')
        else:box=None
        image=await source(request)
        args = (image,box,label.strip().lower(),True) if precision else (image,box,label.strip().lower())
        result,bounds,engine=await execute(request,tools.cutout,*args,precision=precision)
        return png(result,engine,bounds)
    @app.post('/tools/saliency')
    async def saliency(request:Request,columns:int=Query(default=32,ge=4,le=64)):
        return await execute(request,tools.saliency,await source(request),columns)
    @app.post('/tools/extend')
    async def extend(request:Request,left:float=Query(default=0,ge=0,le=1.5),top:float=Query(default=0,ge=0,le=1.5),right:float=Query(default=0,ge=0,le=1.5),bottom:float=Query(default=0,ge=0,le=1.5)):
        if not any((left,top,right,bottom)):raise HTTPException(422,'Specify canvas extension.')
        return png(await execute(request,tools.extend,await source(request),(left,top,right,bottom)),'lama')
    @app.post('/tools/upscale')
    async def upscale(request:Request,scale:int=Query(default=2)):
        if scale not in {2,4}:raise HTTPException(422,'Use scale 2 or 4.')
        return png(await execute(request,tools.upscale,await source(request),scale),f'real-esrgan-x{scale}')
