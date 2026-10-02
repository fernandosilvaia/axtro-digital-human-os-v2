"""Default suite uses only stdlib and deterministic local process fixtures."""
import asyncio
from dataclasses import replace
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[2]
LAB = ROOT / "experiments" / "realtime-lab"
sys.path.insert(0, str(LAB))
from realtime_lab import (ControlHarness, FakeRealtimeControl, GenerationAuthority, GenerationScope,
                          InterruptAck, LabError, OutputFrame, TranscriptSegment, Transcription, word_error_rate)
from whisper_adapter import AudioRequest, FakeWhisperAdapter, WhisperAdapter, WhisperConfig, parse_transcription
import livekit_adapter
import run as lab_run

TENANT = "019f0000-0000-7000-8000-000000000003"
SESSION = "019f0000-0000-7000-8000-000000000004"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class AuthorityTests(unittest.TestCase):
    def test_scope_identity_and_epoch_not_fields_grant_authority(self):
        a = GenerationAuthority(TENANT, SESSION)
        old = a.begin(1)
        forged = GenerationScope(TENANT, SESSION, old.generation, old.authority_epoch)
        self.assertFalse(a.permits(forged))
        self.assertTrue(a.cancel(old))
        for generation in (0, 1):
            with self.assertRaises(LabError): a.begin(generation)
        current = a.begin(2)
        self.assertGreater(current.authority_epoch, old.authority_epoch)
        self.assertFalse(a.cancel(old))
        self.assertTrue(a.permits(current))
        a.close()
        self.assertFalse(a.permits(current))

    def test_invalid_scope_and_generation(self):
        with self.assertRaises(LabError): GenerationAuthority("foreign", SESSION)
        a = GenerationAuthority(TENANT, SESSION)
        for value in (True, 0, -1, float("inf")):
            with self.assertRaises(LabError): a.begin(value)

    def test_wer_unicode_true_insertions_and_bounds(self):
        self.assertEqual(word_error_rate("Olá, CAFÉ!", "olá café")["wer"], 0)
        self.assertEqual(word_error_rate("one", "one two three four")["wer"], 3)
        self.assertEqual(word_error_rate("one two", "")["wer"], 1)
        for ref, hyp in [("", "x"), ("x "*2049, "x"), ("x", "y "*2049), ("x", "\ud800")]:
            with self.assertRaises(LabError): word_error_rate(ref, hyp)

    def test_factory_explicit_no_inference_defaults_and_no_import_side_effect(self):
        observed = {}
        sdk = SimpleNamespace(AgentSession=lambda **kw: observed.update(kw))
        livekit_adapter._session_factory(sdk)
        for key in ("llm", "stt", "tts", "vad"): self.assertIsNone(observed[key])
        self.assertEqual(observed["turn_handling"]["turn_detection"], "manual")
        self.assertFalse(observed["turn_handling"]["preemptive_generation"]["enabled"])
        script = f"import sys;sys.path.insert(0,{str(LAB)!r});import realtime_lab,whisper_adapter,livekit_adapter,run;assert not any(k=='livekit' or k.startswith('livekit.') for k in sys.modules)"
        subprocess.run([sys.executable, "-I", "-c", script], check=True, timeout=10, capture_output=True)

    def test_sdk_subprocess_environment_is_allowlisted_and_python_isolated(self):
        observed = {}
        class Child:
            pid = 999999999
            returncode = 0
            def __init__(self, argv, **kwargs):
                observed.update(argv=argv, kwargs=kwargs)
                kwargs["stdout"].write(b'{}')
                kwargs["stdout"].flush()
            def poll(self): return 0
            def wait(self, **kwargs): return 0
        with patch.dict(os.environ, {"OPENAI_API_KEY":"poisoned-synthetic", "HTTP_PROXY":"http://invalid", "OTEL_EXPORTER_OTLP_ENDPOINT":"http://invalid", "PYTHONPATH":"/invalid"}), patch.object(lab_run.subprocess, "Popen", Child), patch.object(lab_run.os, "killpg") as kill:
            lab_run._run_sdk_child(Path('/synthetic/python'), Path('/synthetic/child'))
        self.assertIn("-I", observed["argv"])
        self.assertEqual(set(observed["kwargs"]["env"]), {"PATH","LANG"})
        self.assertTrue(observed["kwargs"]["start_new_session"])
        kill.assert_called_once()

    def test_sdk_report_is_closed_and_cannot_claim_media_or_pii(self):
        report = lab_run.report_base("sdk_lifecycle_only")
        report.update(sdk_version="1.8.3", interrupt_processed=True, outcome="cancelled", cleanup_complete=True,
            media_input_connected=False, media_output_connected=False, inference_engines_configured=False, real_audio_evaluated=False)
        self.assertEqual(lab_run.validate_sdk_report(report), report)
        for changed in ({**report, "raw_text":"private"}, {**report,"physicalSilenceVerified":True},
                        {**report,"interrupt_processed":1}, {**report,"cost":{**report["cost"],"provider_requests":False}}):
            with self.assertRaises(LabError): lab_run.validate_sdk_report(changed)

    def test_sdk_live_stdout_cap_kills_process_group(self):
        class Child:
            pid = 999999999
            returncode = None
            def __init__(self, argv, **kwargs):
                kwargs['stdout'].write(b'x'*(lab_run.MAX_REPORT_BYTES+1));kwargs['stdout'].flush()
            def poll(self): return None
            def wait(self, **kwargs): return -9
        with patch.object(lab_run.subprocess,'Popen',Child), patch.object(lab_run.os,'killpg') as kill:
            with self.assertRaises(LabError): lab_run._run_sdk_child(Path('/synthetic/python'),Path('/synthetic/child'))
        kill.assert_called_once()

    def test_cli_failure_never_prints_raw_secret_error_or_path(self):
        for error in (RuntimeError("synthetic-sensitive-provider-value"), OSError("synthetic-private-path")):
            with patch.object(sys,"argv",["run.py","--mode","sdk-smoke","--output","/tmp/realtime-test.json"]), patch.object(lab_run,"sdk_smoke_subprocess",side_effect=error):
                from io import StringIO
                output = StringIO()
                with patch.object(sys,"stdout",output): self.assertEqual(lab_run.main(),1)
                self.assertEqual(json.loads(output.getvalue())["code"],"internal_failure")
                self.assertNotIn(str(error),output.getvalue())


class ControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_positive_queue_scope_and_close(self):
        a = GenerationAuthority(TENANT,SESSION); p=FakeRealtimeControl(); h=ControlHarness(a,p)
        s=a.begin(1)
        self.assertEqual(await h.run(s),"completed")
        self.assertEqual(h.take().marker,"first")
        foreign=GenerationAuthority(TENANT,"019f0000-0000-7000-8000-000000000005").begin(1)
        self.assertFalse(h.emit(OutputFrame(foreign,"foreign")))
        other_tenant=GenerationAuthority("019f0000-0000-7000-8000-000000000009",SESSION).begin(1)
        self.assertFalse(h.emit(OutputFrame(other_tenant,"foreign")))
        new=a.begin(2)
        self.assertFalse(h.emit(OutputFrame(s,"late")))
        self.assertFalse(h.emit(OutputFrame(new,"premature")))
        await h.close(); self.assertTrue(p.closed); self.assertTrue(h.cleanup_complete)
        self.assertIsNone(h.take())

    async def test_queue_overflow_revokes_and_new_generation_recovers(self):
        a=GenerationAuthority(TENANT,SESSION); h=ControlHarness(a,FakeRealtimeControl(("a","b")),queue_limit=1)
        s=a.begin(1)
        self.assertEqual(await h.run(s),"backpressure_denied");self.assertFalse(a.permits(s));self.assertIsNone(h.take())
        h.port=FakeRealtimeControl(("c",)); new=a.begin(2)
        self.assertEqual(await h.run(new),"completed");self.assertEqual(h.take().marker,"c")
        await h.close()

    async def test_never_resolving_stream_deadline_and_cancel_race(self):
        a=GenerationAuthority(TENANT,SESSION); p=FakeRealtimeControl(wait=asyncio.Event());h=ControlHarness(a,p,control_timeout=0.005)
        s=a.begin(1);self.assertEqual(await h.run(s,timeout=0.005),"deadline_exceeded")
        self.assertFalse(a.permits(s));self.assertTrue(h.task.done());self.assertFalse(h.emit(OutputFrame(s,"late")))
        await h.close();self.assertTrue(h.cleanup_complete)
        a=GenerationAuthority(TENANT,SESSION);p=FakeRealtimeControl(wait=asyncio.Event());h=ControlHarness(a,p,control_timeout=0.005);s=a.begin(1)
        task=asyncio.create_task(h.run(s));await p.started.wait();ack=await h.cancel(s)
        self.assertTrue(ack.processed);self.assertFalse(ack.physical_silence_verified);self.assertEqual(await task,"cancelled")
        new=a.begin(2);self.assertFalse((await h.cancel(GenerationScope(TENANT,SESSION,1,1))).processed);self.assertTrue(a.permits(new));await h.close()

    async def test_adapter_error_and_close_errors_are_not_success(self):
        a=GenerationAuthority(TENANT,SESSION);h=ControlHarness(a,FakeRealtimeControl(fail=True));self.assertEqual(await h.run(a.begin(1)),"adapter_failure");await h.close()
        class Broken(FakeRealtimeControl):
            async def close(self): raise RuntimeError("private-error")
        a=GenerationAuthority(TENANT,SESSION);h=ControlHarness(a,Broken());await h.close();self.assertFalse(h.cleanup_complete)

    async def test_never_resolving_control_callback_is_bounded(self):
        class Hung(FakeRealtimeControl):
            async def interrupt(self, scope): await asyncio.Event().wait()
            async def close(self): await asyncio.Event().wait()
        a=GenerationAuthority(TENANT,SESSION);p=Hung(wait=asyncio.Event());h=ControlHarness(a,p,control_timeout=0.005);s=a.begin(1)
        running=asyncio.create_task(h.run(s));await p.started.wait()
        self.assertFalse((await h.cancel(s)).processed);await running;await h.close();self.assertFalse(h.cleanup_complete)

    async def test_uncooperative_interrupt_denies_new_generation_admission(self):
        release=asyncio.Event();settled=asyncio.Event()
        class Uncooperative(FakeRealtimeControl):
            streams=0
            async def stream(self,*args):
                self.streams+=1
                await super().stream(*args)
            async def interrupt(self,scope):
                try:
                    while not release.is_set():
                        try: await release.wait()
                        except asyncio.CancelledError: pass
                    return InterruptAck(True)
                finally: settled.set()
        a=GenerationAuthority(TENANT,SESSION);p=Uncooperative(wait=asyncio.Event());h=ControlHarness(a,p,control_timeout=0.005);s=a.begin(1)
        running=asyncio.create_task(h.run(s));await p.started.wait()
        self.assertFalse((await h.cancel(s)).processed);await running
        self.assertFalse(h.cleanup_complete)
        new=a.begin(2)
        self.assertEqual(await h.run(new),'stale_denied')
        self.assertFalse(h.emit(OutputFrame(new,'new')))
        self.assertEqual(p.streams,1)
        release.set();await settled.wait();await h.close()

    async def test_sdk_control_uses_force_and_has_no_physical_silence_claim(self):
        calls=[]
        class Session:
            async def start(self, agent, **kwargs): calls.append(("start",kwargs))
            def interrupt(self, **kwargs):
                calls.append(("interrupt",kwargs));f=asyncio.get_running_loop().create_future();f.set_result(None);return f
            async def aclose(self): calls.append(("close",{}))
        a=GenerationAuthority(TENANT,SESSION);p=livekit_adapter.LiveKitControl(a,Session(),object());h=ControlHarness(a,p);s=a.begin(1)
        running=asyncio.create_task(h.run(s));await p.started.wait();ack=await h.cancel(s);await running;await h.close()
        self.assertEqual(calls[1],("interrupt",{"force":True}));self.assertFalse(ack.physical_silence_verified)
        self.assertEqual(calls[0][1],{"record":False,"session_host":False})


class WhisperTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.binary=self.root/"cli";self.model=self.root/"model.bin";self.model.write_bytes(b"synthetic model")
        self.wav=self.root/"input.wav"
        with wave.open(str(self.wav),"wb") as audio:
            audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes(b"\0\0"*1600)
        self.authority=GenerationAuthority(TENANT,SESSION);self.scope=self.authority.begin(1);self.adapters=[]

    async def asyncTearDown(self):
        for adapter in self.adapters: await adapter.close()
        self.temp.cleanup()

    def adapter(self, body=None, timeout=1):
        body=body or "output={'result':{'language':args['-l']},'transcription':[{'text':' Olá café ', 'offsets':{'from':0,'to':100}}]};path.write_text(json.dumps(output))"
        self.binary.write_text("#!/usr/bin/python3\nimport sys,json,time,os\nfrom pathlib import Path\nargs={sys.argv[i]:sys.argv[i+1] for i in (1,3,5,8,11)}\npath=Path(args['-of']+'.json')\n"+body+"\n")
        self.binary.chmod(0o700)
        config=WhisperConfig(self.binary,digest(self.binary),self.model,digest(self.model),self.root,timeout_seconds=timeout,model_min_bytes=1)
        adapter=WhisperAdapter(self.authority,config);self.adapters.append(adapter);return adapter

    def request(self, **kwargs):
        return replace(AudioRequest(self.wav,digest(self.wav),"pt"),**kwargs)

    def assert_clean(self, adapter):
        self.assertIsNone(adapter._process);self.assertIsNone(adapter._operation)
        self.assertFalse(any(p.name.startswith("whisper-") for p in self.root.iterdir()))

    async def test_real_subprocess_fixed_arguments_and_closed_transcription(self):
        adapter=self.adapter("assert set(args)=={'-m','-f','-l','-of','-t'};assert '-ng' in sys.argv;assert '-oj' in sys.argv and '-np' in sys.argv and '-nf' in sys.argv;assert not any(k in os.environ for k in ['OPENAI_API_KEY','HTTP_PROXY']);output={'result':{'language':args['-l']},'transcription':[{'text':' Olá café ', 'offsets':{'from':0,'to':100},'ignored':'raw'}],'model':'ignored'};path.write_text(json.dumps(output))")
        with patch.dict(os.environ,{"OPENAI_API_KEY":"synthetic-poison","HTTP_PROXY":"http://invalid"}):
            result=await adapter.transcribe(self.scope,self.request(),asyncio.Event())
        self.assertEqual(result.text,"Olá café");self.assertEqual(result.audio_duration_ms,100);self.assertEqual(result.evidence,"local_model_audio");self.assert_clean(adapter)

    async def test_process_failure_timeout_huge_json_and_malformed_cleanup(self):
        cases=[("raise SystemExit(7)","process_failure",1), ("time.sleep(10)","deadline_exceeded",0.03),
               ("path.write_bytes(b'x'*1100000);time.sleep(10)","json_size_bound",1),
               ("path.write_text('{invalid')","malformed_json",1),
               ("path.write_text(json.dumps({'result':{'language':'pt'},'transcription':[{'text':'x','offsets':{'from':0,'to':99999}}]}))","transcription_offset_bound",1)]
        for body,code,timeout in cases:
            with self.subTest(code=code):
                adapter=self.adapter(body,timeout)
                with self.assertRaises(LabError) as raised: await adapter.transcribe(self.scope,self.request(),asyncio.Event())
                self.assertEqual(raised.exception.code,code);self.assert_clean(adapter)

    async def test_hash_language_model_size_and_wav_bounds_before_dispatch(self):
        adapter=self.adapter()
        for request in [self.request(wav_sha256='0'*64),self.request(language='auto')]:
            with self.assertRaises(LabError): await adapter.transcribe(self.scope,request,asyncio.Event())
            self.assert_clean(adapter)
        adapter.config=replace(adapter.config,model_min_bytes=100)
        with self.assertRaises(LabError): await adapter.transcribe(self.scope,self.request(),asyncio.Event())
        self.assert_clean(adapter)
        with wave.open(str(self.wav),"wb") as audio:
            audio.setnchannels(2);audio.setsampwidth(2);audio.setframerate(16000);audio.writeframes(b'\0'*6400)
        adapter.config=replace(adapter.config,model_min_bytes=1)
        with self.assertRaises(LabError): await adapter.transcribe(self.scope,self.request(),asyncio.Event())
        self.assert_clean(adapter)

    async def test_spawn_singleflight_close_and_cancel_race(self):
        adapter=self.adapter("time.sleep(10)")
        gate=asyncio.Event();entered=asyncio.Event();real_spawn=asyncio.create_subprocess_exec;created=[]
        async def delayed(*args,**kwargs):
            p=await real_spawn(*args,**kwargs);created.append(p);entered.set();await gate.wait();return p
        with patch.object(asyncio,'create_subprocess_exec',delayed):
            first=asyncio.create_task(adapter.transcribe(self.scope,self.request(),asyncio.Event()));await entered.wait()
            with self.assertRaises(LabError): await adapter.transcribe(self.scope,self.request(),asyncio.Event())
            closing=asyncio.create_task(adapter.close());await asyncio.sleep(0);gate.set();await closing
            with self.assertRaises(LabError): await first
        self.assertEqual(len(created),1);self.assertIsNotNone(created[0].returncode);self.assert_clean(adapter)

    async def test_cancel_while_spawn_pending_reaps_eventual_handle(self):
        adapter=self.adapter("time.sleep(10)");gate=asyncio.Event();entered=asyncio.Event();real_spawn=asyncio.create_subprocess_exec;created=[]
        async def delayed(*args,**kwargs):
            p=await real_spawn(*args,**kwargs);created.append(p);entered.set();await gate.wait();return p
        with patch.object(asyncio,'create_subprocess_exec',delayed):
            task=asyncio.create_task(adapter.transcribe(self.scope,self.request(),asyncio.Event()));await entered.wait();task.cancel();gate.set()
            with self.assertRaises(asyncio.CancelledError): await task
        self.assertIsNotNone(created[0].returncode);self.assert_clean(adapter)

    async def test_interrupt_after_authority_revocation_owns_only_its_process(self):
        adapter=self.adapter("time.sleep(10)");task=asyncio.create_task(adapter.transcribe(self.scope,self.request(),asyncio.Event()))
        while adapter._process is None: await asyncio.sleep(0)
        self.authority.cancel(self.scope);ack=await adapter.interrupt(self.scope);self.assertTrue(ack.processed)
        with self.assertRaises(LabError): await task
        self.assert_clean(adapter)

    async def test_child_group_is_killed_even_after_parent_exits(self):
        marker=self.root/'child-survived'
        adapter=self.adapter(f"pid=os.fork()\nif pid==0:\n time.sleep(0.3);Path({str(marker)!r}).write_text('unexpected');os._exit(0)\noutput={{'result':{{'language':'pt'}},'transcription':[{{'text':'x','offsets':{{'from':0,'to':100}}}}]}};path.write_text(json.dumps(output))")
        await adapter.transcribe(self.scope,self.request(),asyncio.Event());await asyncio.sleep(0.4)
        self.assertFalse(marker.exists());self.assert_clean(adapter)

    async def test_unresponsive_process_reaping_is_bounded_and_denies_reuse(self):
        adapter=self.adapter();gate=asyncio.Event()
        class Process:
            pid=999999999
            async def wait(self): await gate.wait()
        start=time.monotonic()
        with patch.object(os,'killpg'):
            await adapter._kill_and_reap(Process())
        self.assertLess(time.monotonic()-start,1.5)
        self.assertFalse(adapter.cleanup_complete)
        with self.assertRaises(LabError): await adapter.transcribe(self.scope,self.request(),asyncio.Event())
        gate.set()

    async def test_spawn_deadline_and_incomplete_cleanup_deny_second_operation(self):
        adapter=self.adapter(timeout=0.01);gate=asyncio.Event()
        async def delayed(*args, **kwargs): await gate.wait();raise OSError('synthetic spawn failure')
        start=time.monotonic()
        with patch.object(asyncio,'create_subprocess_exec',delayed):
            with self.assertRaises(LabError) as raised: await adapter.transcribe(self.scope,self.request(),asyncio.Event())
            self.assertEqual(raised.exception.code,'deadline_exceeded')
            self.assertLess(time.monotonic()-start,1.5)
            self.assertFalse(adapter.cleanup_complete)
            new=self.authority.begin(2)
            with self.assertRaises(LabError): await adapter.transcribe(new,self.request(),asyncio.Event())
            gate.set();await adapter._late_cleanup
        self.assert_clean(adapter)

    async def test_report_duration_is_measured_not_claimed_by_manifest(self):
        row={'fixture_id':'pt-eddy','reference':'ola','wav_path':str(self.wav),'wav_sha256':digest(self.wav),
             'language':'pt','duration_seconds':60,'synthetic':True}
        class Port:
            cleanup_complete=True
            def __init__(self,*args): pass
            async def transcribe(self,*args): return Transcription('pt',(TranscriptSegment(0,100,'ola'),),50,'local_model_audio',100)
            async def close(self): pass
        args=SimpleNamespace(binary=self.binary,binary_sha256='0'*64,model=self.model,model_sha256='0'*64,
            fixtures=self.root/'fixtures.json',temp_root=self.root,model_label='tiny',threads=2,timeout=1)
        with patch.object(lab_run,'load_fixtures',return_value=[row]),patch.object(lab_run,'WhisperAdapter',Port):
            report=await lab_run.whisper_benchmark(args)
        self.assertEqual(report['samples'][0]['audio_duration_ms'],100)
        self.assertEqual(report['samples'][0]['real_time_factor'],0.5)
        self.assertNotIn('reference',report['samples'][0])
        Port.cleanup_complete=False
        with patch.object(lab_run,'load_fixtures',return_value=[row]),patch.object(lab_run,'WhisperAdapter',Port):
            with self.assertRaises(LabError) as raised: await lab_run.whisper_benchmark(args)
            self.assertEqual(raised.exception.code,'cleanup_incomplete')

    async def test_fake_port_shape_preserves_scope_and_evidence_separation(self):
        adapter=FakeWhisperAdapter(self.authority,"fixture")
        result=await adapter.transcribe(self.scope,self.request(),asyncio.Event());self.assertEqual(result.evidence,"fake_control");self.assertEqual(result.elapsed_ms,0)
        self.authority.cancel(self.scope)
        with self.assertRaises(LabError): await adapter.transcribe(self.scope,self.request(),asyncio.Event())
        await adapter.close()

    def test_malformed_transcript_closed_bounds(self):
        for item in [{'text':'x','offsets':{'from':0,'to':float('nan')}}, {'text':'','offsets':{'from':0,'to':0}}, {'text':'x'*40001,'offsets':{'from':0,'to':1}}, {'text':'\ud800','offsets':{'from':0,'to':1}}]:
            with self.assertRaises(LabError): parse_transcription({'result':{'language':'pt'},'transcription':[item]},'pt',100)


if __name__ == '__main__':
    unittest.main()
