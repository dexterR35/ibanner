"""Local inference contracts; trained checkpoint tests are explicit opt-ins."""
import base64
import io
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw, ImageFont
from fastapi.testclient import TestClient
from fastapi import HTTPException
from services.sam3_server import create_app
from services.vision.runtime import VisionRuntime, decode_image
from services.vision.media import media_frames

class FakeSam:
    def health(self):return {'ready':False}
class FakeVision:
    def capabilities(self):return {'qwen':{'ready':False},'florence':{'ready':False}}
    def run(self,op,payload):return {'operation':op,'keys':sorted(payload)}
class VisionTests(unittest.TestCase):
    def test_subject_boxes_are_grounded_bounded_and_have_no_invented_scores(self):
        runtime = VisionRuntime()
        image = Image.new('RGB', (2000, 1000))
        with patch.object(runtime, 'load') as load, patch.object(runtime, 'florence_task', return_value={
            'bboxes': [[-10, 20, 1200, 500], [5, 5, 5, 10], [0, 0, float('nan'), 20], ['bad'], [0, 0, 20, 30]]
        }) as task:
            result = runtime.run('subjects', {'sourceImage': image, 'labels': ['trophy']})
        load.assert_called_once_with('florence')
        self.assertEqual(image.size, (1024, 512))
        task.assert_called_once_with(image, '<CAPTION_TO_PHRASE_GROUNDING>', max_tokens=256, text='trophy')
        self.assertEqual(len(result), 2)
        self.assertNotIn('score', result[0])
        self.assertEqual(result[0]['box']['xmin'], 0)
        self.assertEqual(result[0]['box']['xmax'], 1)

    def test_florence_regions_are_model_only_bounded_and_profile_pinned(self):
        data=io.BytesIO();Image.new('RGB',(100,80),'white').save(data,format='PNG')
        runtime=VisionRuntime()
        profile={'profileId':'a'*64,'contract':{'revision':'b'*40},'device':'cpu'}
        answers={'<OCR_WITH_REGION>':{'quad_boxes':[[10,10,30,10,30,20,10,20],[-5,5,8,5,8,15,-5,15]],'labels':['Offer','Edge']},
                 '<OD>':{'bboxes':[[20,20,110,70]],'labels':['person']}}
        with patch.object(runtime,'load',return_value=profile), patch.object(runtime,'florence_task',side_effect=lambda image,task,**kwargs:answers[task]):
            result=runtime.run('reference',{'image':base64.b64encode(data.getvalue()).decode(),'profileId':'a'*64})
            self.assertEqual([region['text'] for region in result['textRegions']],['Offer','Edge'])
            self.assertAlmostEqual(result['textRegions'][1]['box']['x'],0)
            self.assertAlmostEqual(result['objects'][0]['box']['x']+result['objects'][0]['box']['width'],1)
            self.assertEqual(result['provenance']['tasks'],['<OCR_WITH_REGION>','<OD>'])
            with self.assertRaises(HTTPException):
                runtime.run('reference',{'image':base64.b64encode(data.getvalue()).decode(),'profileId':'c'*64})

    def test_florence_profile_selects_cuda_when_suitable_and_cpu_otherwise(self):
        from services.vision.models import select_florence_profile
        hardware={'memory':{'totalGB':16,'availableGB':9},'cuda':[
            {'index':0,'name':'GPU','totalGiB':6,'freeGiB':5,'bfloat16':False}], 'error':None}
        self.assertEqual(select_florence_profile(hardware)['device'],'cuda:0')
        self.assertEqual(select_florence_profile(hardware,'cpu')['device'],'cpu')
        hardware['cuda']=[]
        self.assertEqual(select_florence_profile(hardware)['device'],'cpu')
        self.assertFalse(select_florence_profile(hardware,'cuda')['ready'])

    def test_local_origins_bounds_and_operation_allowlist(self):
        client=TestClient(create_app(FakeSam(),vision=FakeVision()),base_url='http://127.0.0.1:5181')
        self.assertFalse(client.get('/vision/capabilities').json()['qwen']['ready'])
        self.assertEqual(client.post('/vision/layout',json={'targets':[]}).json()['operation'],'layout')
        # The fixed-composition planner was removed; Create uses /vision/layout.
        self.assertEqual(client.post('/vision/plan',json={}).status_code,404)
        self.assertEqual(client.post('/vision/reference',json={'image':'fixture'}).json()['operation'],'reference')
        self.assertEqual(client.post('/vision/execute',json={}).status_code,404)
        self.assertEqual(client.post('/vision/layout',json=[]).status_code,422)
        self.assertEqual(client.post('/vision/layout',json={},headers={'origin':'https://untrusted.example'}).status_code,403)
        self.assertEqual(client.post('/vision/reference',content=b'x'*13_000_001).status_code,413)
        # SigLIP embeddings were removed; /vision/ocr is PaddleOCR (RapidOCR), not Tesseract.
        self.assertEqual(client.post('/vision/embed',json={}).status_code,404)
        self.assertEqual(client.post('/vision/ocr',json={'image':'fixture'}).json()['operation'],'ocr')
        self.assertNotIn('siglip',client.get('/vision/capabilities').json())
    def test_unavailable_models_do_not_load_or_download(self):
        with patch.dict(os.environ,{'BANNERFLOW_QWEN_MODEL':'','BANNERFLOW_FLORENCE_MODEL':''}):
            runtime=VisionRuntime();self.assertFalse(runtime.profile('qwen')['ready']);self.assertFalse(runtime.profile('florence')['ready']);self.assertIsNone(runtime.model)
            with self.assertRaises(HTTPException):runtime.load('qwen')
            with self.assertRaises(HTTPException):runtime.load('florence')
    def test_decode_rejects_urls_nonimages_and_large_previews(self):
        for value in ['https://untrusted/image.png','a'*12_000_001,base64.b64encode(b'not an image').decode()]:
            with self.assertRaises(HTTPException):decode_image(value)
    def test_ocr_reports_missing_runtime_and_rejects_stale_profiles(self):
        from services.vision import ocr
        import importlib.metadata as metadata
        with patch.object(metadata,'version',side_effect=metadata.PackageNotFoundError('rapidocr')):
            status=ocr.ocr_status()
        self.assertFalse(status['ready']);self.assertIn('ai:setup',status['message'])
        with patch.object(metadata,'version',return_value='0.0.1'):
            self.assertIn('pinned rapidocr',ocr.ocr_status()['message'])
        data=io.BytesIO();Image.new('RGB',(40,30),'white').save(data,format='PNG')
        image=base64.b64encode(data.getvalue()).decode()
        ready={'ready':True,'profileId':'a'*64,'contract':{},'models':'x','message':None}
        with patch('services.vision.runtime.ocr_status',return_value=ready), patch('services.vision.runtime.read_text',return_value={'lines':[]}) as read:
            self.assertEqual(VisionRuntime().run('ocr',{'image':image,'profileId':'a'*64}),{'lines':[]})
            with self.assertRaises(HTTPException) as stale:
                VisionRuntime().run('ocr',{'image':image,'profileId':'b'*64})
            self.assertEqual(stale.exception.status_code,409);read.assert_called_once()
        with patch('services.vision.runtime.ocr_status',return_value={'ready':False,'message':'missing'}):
            with self.assertRaises(HTTPException) as missing:
                VisionRuntime().run('ocr',{'image':image})
            self.assertEqual(missing.exception.status_code,503)
    def test_real_paddleocr_reads_accented_text_with_bounded_boxes(self):
        from services.vision.ocr import ocr_status
        if not ocr_status()['ready']: self.skipTest('PaddleOCR (RapidOCR) not installed')
        fonts=[f for f in ('C:/Windows/Fonts/arialbd.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','/Library/Fonts/Arial Bold.ttf') if Path(f).is_file()]
        if not fonts: self.skipTest('No known TrueType font for the OCR fixture')
        image=Image.new('RGB',(640,200),'#101828');draw=ImageDraw.Draw(image)
        draw.text((24,30),'BANNERFLOW 2026',font=ImageFont.truetype(fonts[0],48),fill='white')
        draw.text((24,130),'Käyttöehdot pätevät',font=ImageFont.truetype(fonts[0],26),fill='white')
        buffer=io.BytesIO();image.save(buffer,format='PNG')
        result=VisionRuntime().run('ocr',{'image':base64.b64encode(buffer.getvalue()).decode()})
        self.assertEqual(result['engine'],'rapidocr');self.assertEqual(len(result['profileId']),64)
        text=' '.join(line['text'] for line in result['lines'])
        self.assertIn('BANNERFLOW',text);self.assertIn('Käyttöehdot',text)
        big,small=result['lines'][0],result['lines'][-1]
        self.assertGreater(big['box']['height'],small['box']['height'])
        for line in result['lines']:
            b=line['box'];self.assertLessEqual(b['x']+b['width'],1.0001);self.assertLessEqual(b['y']+b['height'],1.0001)
            self.assertTrue(0<=line['confidence']<=1)
    def test_gif_frame_delays_and_original_bytes_are_preserved(self):
        frames=[Image.new('RGB',(40,30),c) for c in ['red','blue','green']];buffer=io.BytesIO();frames[0].save(buffer,format='GIF',save_all=True,append_images=frames[1:],duration=[100,230,410],loop=0)
        source=buffer.getvalue();result=media_frames(source);self.assertEqual(result['durationMs'],740);self.assertEqual([f['timestampMs'] for f in result['frames']],[0,100,330]);self.assertEqual([f['durationMs'] for f in result['frames']],[100,230,410]);self.assertEqual(source,buffer.getvalue())
    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'Local video decoders unavailable')
    def test_real_video_frames_preserve_index_timestamps(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'fixture.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc=size=96x64:rate=5','-t','1','-c:v','mpeg4','-pix_fmt','yuv420p',str(path)],check=True,capture_output=True)
            result=media_frames(path.read_bytes(),count=3)
            self.assertEqual(result['codec'],'mpeg4')
            self.assertEqual([f['frameIndex'] for f in result['frames']],[0,2,4])
            self.assertEqual([f['timestampMs'] for f in result['frames']],[0,400,800])
            for frame in result['frames']:
                image=Image.open(io.BytesIO(base64.b64decode(frame['image'])))
                self.assertEqual(image.format,'PNG')
    def test_final_gif_delay_cannot_exceed_duration_budget(self):
        image=Image.new('RGB',(10,10),'red');data=io.BytesIO();image.save(data,format='GIF',duration=120010)
        with self.assertRaises(HTTPException):media_frames(data.getvalue())
    @unittest.skipUnless(os.environ.get('BANNERFLOW_REAL_QWEN')=='1','Trained Qwen checkpoint not configured for smoke testing')
    def test_real_qwen_checkpoint(self):
        runtime=VisionRuntime();self.assertTrue(runtime.profile('qwen')['ready']);runtime.load('qwen');self.assertIsNotNone(runtime.model)

class QwenSetupTests(unittest.TestCase):
    def fixture(self, folder):
        import json, struct
        root = Path(folder)
        (root/'config.json').write_text(json.dumps({'model_type':'qwen3_vl','text_config':{'hidden_size':4096}}))
        for name in ('tokenizer.json','tokenizer_config.json','preprocessor_config.json','chat_template.json'):
            (root/name).write_text('{}')
        header = json.dumps({'weight':{'dtype':'F32','shape':[1],'data_offsets':[0,4]}}).encode()
        (root/'model.safetensors').write_bytes(struct.pack('<Q',len(header))+header+b'\0'*4)
        return {'BANNERFLOW_QWEN_MODEL': folder, 'BANNERFLOW_QWEN_REVISION': 'a'*40}

    def test_ram_upgrade_enables_installed_profile_without_loading(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,self.fixture(folder)), patch('services.vision.runtime.importlib.metadata.version',return_value='5.17.0'):
            runtime = VisionRuntime()
            with patch('services.vision.runtime.hardware_status',return_value={'memory':{'totalGB':16,'availableGB':12},'cuda':[],'torch':'fixture','error':None}):
                profile=runtime.profile('qwen')
                self.assertTrue(profile['installed']); self.assertFalse(profile['ready'])
                with self.assertRaises(HTTPException): runtime.load('qwen')
                self.assertIsNone(runtime.model)
            with patch('services.vision.runtime.hardware_status',return_value={'memory':{'totalGB':64,'availableGB':48},'cuda':[],'torch':'fixture','error':None}):
                self.assertTrue(runtime.profile('qwen')['ready'])
                self.assertIsNone(runtime.model)
            with patch('services.vision.runtime.hardware_status',return_value={'memory':{'totalGB':64,'availableGB':12},'cuda':[],'torch':'fixture','error':None}):
                with self.assertRaisesRegex(HTTPException,'available RAM'): runtime.load('qwen')
                self.assertIsNone(runtime.model)

    def test_truncated_weights_and_missing_shards_are_not_reported_installed(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,self.fixture(folder)), patch('services.vision.runtime.importlib.metadata.version',return_value='5.17.0'):
            p=Path(folder)/'model.safetensors'; p.write_bytes(p.read_bytes()[:-1])
            self.assertFalse(VisionRuntime().profile('qwen')['ready'])
            (Path(folder)/'model.safetensors.index.json').write_text('{"weight_map":{"x":"missing.safetensors"}}')
            self.assertIn('incomplete',VisionRuntime().profile('qwen')['message'])

    def test_explicit_disable_and_pinned_default_discovery(self):
        from services.vision.models import model_location, QWEN_REVISION
        with patch.dict(os.environ,{'BANNERFLOW_QWEN_MODEL':''}):
            self.assertEqual(model_location('qwen')[0],'')
        with patch.dict(os.environ,{},clear=True):
            path, revision=model_location('qwen')
            self.assertEqual(Path(path).parts[-2:],('snapshots',QWEN_REVISION)); self.assertEqual(revision,QWEN_REVISION)

    def test_scheduler_releases_other_models_and_rejects_overlapping_jobs(self):
        from services.vision.scheduler import ModelScheduler
        scheduler=ModelScheduler(idle_seconds=60); events=[]
        scheduler.register('sam',lambda:events.append('unload-sam'))
        scheduler.register('vision',lambda:events.append('unload-vision'))
        scheduler.run('sam',lambda:events.append('sam'))
        def planning():
            events.append('qwen')
            with self.assertRaises(HTTPException) as error: scheduler.run('sam',lambda:None)
            self.assertEqual(error.exception.status_code,429)
        scheduler.run('vision',planning)
        self.assertEqual(events,['unload-vision','sam','unload-sam','qwen'])
        scheduler.run('sam',lambda:events.append('sam-again'))
        self.assertEqual(events[-2:],['unload-vision','sam-again'])


    def test_portable_cuda_cpu_and_explicit_device_profiles(self):
        from services.vision.models import select_qwen_profile
        hardware={'memory':{'totalGB':16,'availableGB':10},'cuda':[
            {'index':0,'name':'Small GPU','totalGiB':8,'freeGiB':7,'bfloat16':False},
            {'index':1,'name':'CUDA GPU','totalGiB':12,'freeGiB':11,'bfloat16':True}], 'error':None}
        selected=select_qwen_profile(hardware)
        self.assertTrue(selected['ready']); self.assertEqual(selected['device'],'cuda:1'); self.assertEqual(selected['dtype'],'bfloat16')
        hardware['cuda'][1]['bfloat16']=False
        self.assertEqual(select_qwen_profile(hardware)['dtype'],'float16')
        self.assertFalse(select_qwen_profile(hardware,'cuda:0')['ready'])
        self.assertFalse(select_qwen_profile(hardware,'cuda:99')['ready'])
        self.assertFalse(select_qwen_profile(hardware,'invalid')['ready'])
        self.assertFalse(select_qwen_profile(hardware,'cpu')['ready'])
        hardware['memory']['totalGB']=64; hardware['cuda']=hardware['cuda'][:1]
        selected=select_qwen_profile(hardware)
        self.assertTrue(selected['ready']); self.assertEqual(selected['device'],'cpu')
        self.assertEqual(selected['dtype'],'float32')
        hardware['cuda']=[]
        self.assertFalse(select_qwen_profile(hardware,'cuda')['ready'])

    def test_cuda_loader_streams_to_selected_device_and_moves_multimodal_inputs(self):
        import torch
        from unittest.mock import MagicMock
        from services.vision.models import select_qwen_profile
        hardware={'memory':{'totalGB':16,'availableGB':10},'cuda':[
            {'index':1,'name':'CUDA fixture','totalGiB':12,'freeGiB':11,'bfloat16':True}], 'error':None}
        profile={**select_qwen_profile(hardware),'profileId':'fixture','hardware':hardware,'contract':{}}
        inputs=MagicMock(); inputs.input_ids=torch.tensor([[1,2]])
        inputs.to.return_value={'input_ids':inputs.input_ids}
        class Batch(dict):
            input_ids=torch.tensor([[1,2]])
            def to(self, device): self.device_used=device; return self
        batch=Batch(input_ids=torch.tensor([[1,2]]))
        processor=MagicMock(); processor.apply_chat_template.return_value=batch
        processor.batch_decode.return_value=['{}']
        model=MagicMock(); model.eval.return_value=model; model.device='cuda:1'
        model.generate.return_value=torch.tensor([[1,2,3]])
        data=io.BytesIO(); Image.new('RGB',(32,32)).save(data,format='PNG')
        runtime=VisionRuntime()
        with patch.object(runtime,'profile',return_value=profile), patch('services.vision.runtime.model_location',return_value=('/fixture','a'*40)), patch('transformers.AutoProcessor.from_pretrained',return_value=processor), patch('transformers.Qwen3VLForConditionalGeneration.from_pretrained',return_value=model) as loader:
            layout={'samples':1,'targets':[{'id':'BANNER1-300x250','width':300,'height':250,
                    'elements':[{'id':'headline_0'}],'examples':[]}]}
            result=runtime.layout(layout)
            self.assertEqual(loader.call_args.kwargs['device_map'],{'':'cuda:1'})
            self.assertEqual(loader.call_args.kwargs['dtype'],torch.bfloat16)
            self.assertTrue(loader.call_args.kwargs['local_files_only'])
            self.assertFalse(loader.call_args.kwargs['trust_remote_code'])
            quantization = loader.call_args.kwargs['quantization_config']
            self.assertTrue(quantization.load_in_4bit)
            self.assertEqual(quantization.bnb_4bit_quant_type, 'nf4')
            self.assertTrue(quantization.bnb_4bit_use_double_quant)
            self.assertEqual(batch.device_used,'cuda:1')
            self.assertEqual(result['method'],'postero-icl')
            self.assertEqual(result['targets'][0]['candidates'][0]['complete'],False)
            self.assertTrue(model.generate.call_args.kwargs['do_sample'])
            self.assertEqual(model.generate.call_args.kwargs['num_return_sequences'],1)
            with self.assertRaisesRegex(HTTPException,'precision'):
                runtime.layout({**layout,'modelPrecision':'fp8'})
        runtime.unload()
        self.assertIsNone(runtime.model)
        profile['gpu']['freeGiB']=4
        with patch.object(runtime,'profile',return_value=profile):
            with self.assertRaisesRegex(HTTPException,'free GPU memory'): runtime.load('qwen')



class QwenVariantTests(unittest.TestCase):
    """Registry-driven checkpoints: pinned, allowlisted and sized to the GPU."""
    def fixture(self, folder, model_type='qwen3_vl', hidden=4096):
        import json, struct
        root = Path(folder)
        (root/'config.json').write_text(json.dumps({'model_type':model_type,'text_config':{'hidden_size':hidden}}))
        for name in ('tokenizer.json','tokenizer_config.json','preprocessor_config.json','chat_template.json'):
            (root/name).write_text('{}')
        header = json.dumps({'weight':{'dtype':'F32','shape':[1],'data_offsets':[0,4]}}).encode()
        (root/'model.safetensors').write_bytes(struct.pack('<Q',len(header))+header+b'\0'*4)
        return {'BANNERFLOW_QWEN_MODEL': folder, 'BANNERFLOW_QWEN_REVISION': 'a'*40}

    def gpu_hardware(self, total=15.9, kernels=True):
        return {'memory':{'totalGB':64,'availableGB':50},'error':None,'torch':'fixture','cudaRuntime':'13.0',
                'cuda':[{'index':0,'name':'RTX 5060 Ti','capability':'12.0','totalGiB':total,'freeGiB':total-1,'bfloat16':True,'kernels':kernels}]}

    def test_registry_is_pinned_allowlisted_and_loadable(self):
        import transformers
        from services.vision.models import qwen_registry, QWEN_LOADERS, QWEN_REVISION
        registry = qwen_registry()
        self.assertEqual(registry['default'], 'qwen3-vl-8b')
        self.assertEqual(list(registry['variants']), ['qwen3-vl-8b'])
        self.assertEqual(QWEN_REVISION, '0c351dd01ed87e9c1b53cbc748cba10e6187ff3b')
        for name, variant in registry['variants'].items():
            self.assertRegex(variant['revision'], r'^[a-f0-9]{40}$')
            self.assertIn(variant['loader'], QWEN_LOADERS)
            self.assertTrue(hasattr(transformers, variant['loader']), name)
            cuda = variant['budgets']['cuda']
            self.assertLessEqual(cuda['availableVRAMGiB'], cuda['minimumVRAMGiB'])
            # Weights (GB) must fit inside the free-VRAM budget (GiB) with room for the KV cache.
            self.assertGreater(cuda['availableVRAMGiB'], variant['weightsGB'] / 1.0737, name)

    def test_selected_variant_defines_the_expected_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{**self.fixture(folder,'wrong',4096),'BANNERFLOW_QWEN_VARIANT':'qwen3-vl-8b'}), \
             patch('services.vision.runtime.importlib.metadata.version',return_value='5.17.0'), \
             patch('services.vision.runtime.hardware_status',return_value=self.gpu_hardware()):
            self.assertIn('Wrong checkpoint family', VisionRuntime().profile('qwen')['message'])
            self.fixture(folder,'qwen3_vl',4096)
            profile = VisionRuntime().profile('qwen')
            self.assertTrue(profile['ready']); self.assertEqual(profile['device'],'cuda:0')
            self.assertEqual(profile['model'],'Qwen/Qwen3-VL-8B-Instruct'); self.assertEqual(profile['contract']['variant'],'qwen3-vl-8b')
            self.fixture(folder,'qwen3_vl',2560)
            self.assertIn('Qwen3-VL 8B', VisionRuntime().profile('qwen')['message'])
        with patch.dict(os.environ,{'BANNERFLOW_QWEN_VARIANT':'qwen-unknown'}):
            self.assertIn('Unknown', VisionRuntime().profile('qwen')['message'])

    def test_variant_budgets_follow_gpu_memory(self):
        from services.vision.models import select_qwen_profile, qwen_variant
        sixteen = self.gpu_hardware(15.9)
        small = select_qwen_profile(sixteen)
        self.assertEqual(small['device'], 'cuda:0')
        self.assertEqual(small['quantization'], 'nf4')
        self.assertEqual(small['requirements']['availableVRAMGiB'], 9)
        large = select_qwen_profile(self.gpu_hardware(23.8))
        self.assertEqual(large['device'], 'cuda:0')
        self.assertIsNone(large['quantization'])
        eight = self.gpu_hardware(7.9)
        self.assertEqual(select_qwen_profile(eight)['device'], 'cpu')
        self.assertFalse(select_qwen_profile(eight, 'cuda')['ready'])
        with patch.dict(os.environ, {'BANNERFLOW_QWEN_PRECISION': 'bf16'}):
            self.assertEqual(select_qwen_profile(sixteen)['device'], 'cpu')
            self.assertFalse(select_qwen_profile(sixteen, 'cuda')['ready'])
        with patch.dict(os.environ, {'BANNERFLOW_QWEN_PRECISION': 'nf4'}):
            self.assertFalse(select_qwen_profile(sixteen, 'cpu')['ready'])
        for removed in ['unsupported-checkpoint']:
            with self.assertRaises(ValueError): qwen_variant(removed)

    def test_request_model_selection_is_local_and_does_not_mutate_environment(self):
        from services.vision.models import model_location, qwen_variant_id
        default = qwen_variant_id()
        selected, revision = model_location('qwen', 'unsupported-checkpoint')
        self.assertIsNone(selected)
        self.assertEqual(revision, '')
        self.assertEqual(qwen_variant_id(), default)

    def test_gpu_without_kernels_is_skipped_with_setup_hint(self):
        from services.vision.models import select_qwen_profile, select_florence_profile
        hardware = self.gpu_hardware(kernels=False)
        auto = select_qwen_profile(hardware)
        self.assertEqual(auto['device'],'cpu'); self.assertIn('ai:setup', auto['warning'])
        explicit = select_qwen_profile(hardware,'cuda')
        self.assertFalse(explicit['ready']); self.assertIn('no kernels', explicit['message'])
        self.assertEqual(select_florence_profile(hardware)['device'],'cpu')
        self.assertFalse(select_florence_profile(hardware,'cuda:0')['ready'])

    def test_missing_download_names_the_command(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ,{'BANNERFLOW_QWEN_MODEL':folder,'BANNERFLOW_QWEN_REVISION':'a'*40}):
            os.environ.pop('BANNERFLOW_QWEN_VARIANT', None)
            message = VisionRuntime().profile('qwen')['message']
            self.assertIn('not downloaded', message); self.assertIn('npm run qwen:download.', message)
            with patch.dict(os.environ,{'BANNERFLOW_QWEN_VARIANT':'qwen3-vl-8b'}):
                self.assertIn('--variant qwen3-vl-8b', VisionRuntime().profile('qwen')['message'])

    def test_reasoning_block_is_removed_before_validation(self):
        from services.vision.runtime import strip_reasoning
        self.assertEqual(strip_reasoning('<think>\nrank variants\n</think>\n\n{"a":1}'), '{"a":1}')
        self.assertEqual(strip_reasoning('{"a":"<think>x</think>"}'), '{"a":"<think>x</think>"}')

    def test_real_qwen3_vl_multimodal_cpu_generation_with_tiny_random_weights(self):
        import torch
        from transformers import Qwen3VLConfig, Qwen3VLForConditionalGeneration
        torch.manual_seed(0); torch.set_num_threads(2)
        config=Qwen3VLConfig(
            text_config={'vocab_size':128,'hidden_size':32,'intermediate_size':64,'num_hidden_layers':2,
                         'num_attention_heads':2,'num_key_value_heads':2,'head_dim':16,'max_position_embeddings':128,
                         'bos_token_id':10,'eos_token_id':11,'pad_token_id':0,
                         'rope_parameters':{'rope_type':'default','rope_theta':1000000.0,'mrope_section':[4,2,2],'mrope_interleaved':True}},
            vision_config={'depth':2,'hidden_size':32,'intermediate_size':64,'num_heads':2,'out_hidden_size':32,
                           'patch_size':16,'temporal_patch_size':2,'spatial_merge_size':2,'num_position_embeddings':16,
                           'deepstack_visual_indexes':[1]},
            image_token_id=3,video_token_id=4,vision_start_token_id=1,vision_end_token_id=2)
        model=Qwen3VLForConditionalGeneration(config).eval()
        tokens=torch.tensor([[10,1,3,3,3,3,2,5]])
        with torch.inference_mode():
            output=model.generate(input_ids=tokens,attention_mask=torch.ones_like(tokens),
                                  pixel_values=torch.randn(16,3*2*16*16),image_grid_thw=torch.tensor([[1,4,4]]),
                                  max_new_tokens=2,do_sample=False)
        self.assertGreater(output.shape[1],tokens.shape[1])
        self.assertTrue(torch.equal(output[:,:tokens.shape[1]],tokens))

    def test_qwen3_processor_option_bounds_visual_tokens(self):
        from transformers import Qwen2VLImageProcessor
        from services.vision.models import qwen_variant
        processor=Qwen2VLImageProcessor(patch_size=16,merge_size=2,temporal_patch_size=2,**qwen_variant('qwen3-vl-8b')['processorOptions'])
        for size in ((1024,768),(64,64),(1600,200)):
            grid=processor(images=[Image.new('RGB',size)],return_tensors='pt')['image_grid_thw'][0]
            self.assertTrue(64<=int(grid.prod())//4<=256,size)


class ShortenCopyTests(unittest.TestCase):
    """Shorter copy is a bounded suggestion; legal copy and invented figures are refused."""
    def runtime_with(self, text):
        import torch
        from unittest.mock import MagicMock
        runtime = VisionRuntime()
        class Batch(dict):
            input_ids = torch.tensor([[1, 2]])
            def to(self, device): return self
        runtime.processor = MagicMock()
        runtime.processor.apply_chat_template.return_value = Batch()
        runtime.processor.batch_decode.return_value = [text]
        runtime.model = MagicMock(); runtime.model.device = 'cpu'
        runtime.model.generate.return_value = torch.tensor([[1, 2, 3]])
        profile = {'profileId': 'p', 'contract': {}, 'variant': 'qwen3-vl-8b'}
        return runtime, patch.object(runtime, 'load', return_value=profile)

    def test_suggestions_are_bounded_and_filtered(self):
        reply = ('<think>x</think>{"suggestions":["Big deals today", "Visit www.example.com now", '
                 '"Save 500 euro", "This one is far too long for the limit", "Big deals today"]}')
        runtime, loaded = self.runtime_with(reply)
        with loaded:
            result = runtime.run('shorten', {'role': 'headline', 'text': 'Big new deals every single day', 'maxChars': 20, 'locale': 'en'})
        self.assertEqual(result['suggestions'], ['Big deals today'])
        prompt = runtime.processor.apply_chat_template.call_args.args[0][0]['content'][0]['text']
        self.assertIn('at most 20 characters', prompt)

    def test_legal_and_invalid_requests_are_rejected(self):
        runtime, loaded = self.runtime_with('{"suggestions":["x"]}')
        with loaded:
            for payload in ({'role': 'legal', 'text': '18+ | Play responsibly', 'maxChars': 5},
                            {'role': 'headline', 'text': 'Short', 'maxChars': 10},
                            {'role': 'cta', 'text': 'Play now please', 'maxChars': 5, 'locale': 'en; drop'}):
                with self.assertRaises(HTTPException) as error:
                    runtime.run('shorten', payload)
                self.assertEqual(error.exception.status_code, 422)

    def test_no_usable_suggestion_is_an_explicit_error(self):
        runtime, loaded = self.runtime_with('not json')
        with loaded, self.assertRaisesRegex(HTTPException, 'Edit the copy manually'):
            runtime.run('shorten', {'role': 'subtitle', 'text': 'New deals all weekend long', 'maxChars': 12})
