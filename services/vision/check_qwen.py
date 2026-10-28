"""Portable Qwen preflight; --smoke explicitly loads and exercises trained weights."""
import argparse
import base64
import io
import json
import os
import time
from PIL import Image
from .runtime import VisionRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--smoke', action='store_true', help='Run real inference after preflight')
    parser.add_argument('--variant', help='Check this registry variant instead of BANNERFLOW_QWEN_VARIANT')
    args = parser.parse_args()
    if args.variant:
        os.environ['BANNERFLOW_QWEN_VARIANT'] = args.variant
    runtime = VisionRuntime()
    profile = runtime.profile('qwen')
    print(json.dumps({k: profile.get(k) for k in ('model', 'variant', 'installed', 'ready', 'device', 'deviceName', 'dtype', 'quantization', 'requirements', 'hardware', 'message', 'warning')}, indent=2))
    if not args.smoke:
        return
    if not profile['ready']:
        raise SystemExit('Resolve the reported prerequisites before running real inference.')
    asset, brief, copy = 'a'*64, 'b'*64, 'c'*64
    context = {'brief': 'Place the image beside the supplied headline.', 'briefRevisionId': brief,
               'copyRevisionId': copy, 'copy': {'headline':'WIN TODAY','subtitle':'','cta':'PLAY','legal':'18+'},
               'assetIds':[asset], 'roleBindings':{'hero':asset}, 'variants':['hero-right','hero-left'],
               'targets':[{'id':'smoke-300x250','width':300,'height':250}], 'targetPresetIds':['smoke-300x250'],
               'styleTokenSetId':'smoke-draft', 'familyId':'campaign-hero'}
    image=Image.new('RGB',(256,256),'#688bad'); encoded=io.BytesIO(); image.save(encoded,format='PNG')
    started=time.perf_counter()
    from .scheduler import ModelScheduler
    scheduler = ModelScheduler()
    scheduler.register('vision', runtime.unload)
    result=scheduler.run('vision',runtime.run,'plan',{'context':context,'image':base64.b64encode(encoded.getvalue()).decode()})
    seconds=round(time.perf_counter()-started,1)
    raw = result['plan'].strip()
    if raw.startswith('```') and raw.endswith('```'):
        raw = raw.split('\n', 1)[1].rsplit('```', 1)[0]
    plan=json.loads(raw)
    checks = {'schemaVersion':1,'briefRevisionId':brief,'copyRevisionId':copy,'copyPolicy':'preserve-exact',
              'familyId':'campaign-hero','inputAssetIds':[asset],'roleBindings':context['roleBindings'],
              'styleTokenSetId':'smoke-draft','targetPresetIds':context['targetPresetIds']}
    failed=[k for k,v in checks.items() if plan.get(k)!=v]
    if not plan.get('variantPriority') or any(v not in context['variants'] for v in plan['variantPriority']):
        failed.append('variantPriority')
    if failed:
        print(json.dumps({'smoke':'failed','secondsIncludingLoad':seconds,'mismatchedFields':failed,'plan':plan},indent=2))
        raise SystemExit('Inference ran, but the plan failed the smoke contract. The app will reject invalid plans.')
    peak=None
    if profile['device'].startswith('cuda'):
        import torch
        peak=round(torch.cuda.max_memory_allocated(profile['device'])/1024**3,2)
    print(json.dumps({'smoke':'passed','secondsIncludingLoad':seconds,'peakAllocatedGiB':peak,'afterJob':scheduler.status(),'plan':plan,'provenance':result['provenance']},indent=2))


if __name__ == '__main__':
    main()
