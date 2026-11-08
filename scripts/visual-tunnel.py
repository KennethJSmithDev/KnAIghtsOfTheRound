"""Owned fixed-destination HTTP tunnel; the browser broker has no Docker control. The separate launch operator supplies --state."""
import base64,json,subprocess,threading,time,os,datetime
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--state',type=Path,required=True)
ROOT=parser.parse_args().state.resolve()
fixture=json.loads((ROOT/'fixture.json').read_text())
cid=fixture['container']
info=json.loads(subprocess.check_output(['docker','inspect',cid],creationflags=subprocess.CREATE_NO_WINDOW))[0]
if info['Id']!=cid or info['Config']['Labels'].get('org.kotr.owner')!=fixture['owner']:raise SystemExit('Fixture ownership mismatch')
GUEST=r"""
import sys,json,urllib.request,urllib.error,base64
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
print('{"ready":true}',flush=True)
for line in sys.stdin:
 try:
  v=json.loads(line)
  if (v['method'],v['path']) not in [('GET','/knaights-live/v1/session'),('POST','/knaights-live/v1/run')]:raise ValueError('route')
  body=base64.b64decode(v['body']) if v['method']=='POST' else None
  if body and len(body)>1024:raise ValueError('size')
  req=urllib.request.Request('http://127.0.0.1:52773'+v['path'],data=body,method=v['method'],headers={'Content-Type':'application/json','Authorization':v['authorization']})
  try:
   with opener.open(req,timeout=225) as r:status,raw=r.status,r.read(262145)
  except urllib.error.HTTPError as e:status,raw=e.code,e.read(262145)
  if len(raw)>262144:raise ValueError('response size')
  print(json.dumps({'status':status,'body':base64.b64encode(raw).decode()}),flush=True)
 except Exception:print('{"status":502,"body":"e30="}',flush=True)
"""
err=(ROOT/'gateway-tunnel.stderr').open('wb')
guest=subprocess.Popen(['docker','exec','--user','51773','-i',cid,'python3','-u','-c',GUEST],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1,creationflags=subprocess.CREATE_NO_WINDOW)
if json.loads(guest.stdout.readline()).get('ready') is not True:raise SystemExit('Tunnel worker not ready')
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def serve(self):
  if self.path not in ('/knaights-live/v1/session','/knaights-live/v1/run'):self.send_error(404);return
  n=int(self.headers.get('Content-Length','0'))
  if not 0<=n<=1024:self.send_error(413);return
  item={'method':self.command,'path':self.path,'authorization':self.headers.get('Authorization',''),'body':base64.b64encode(self.rfile.read(n)).decode()}
  with lock:
   guest.stdin.write(json.dumps(item)+'\n');guest.stdin.flush();reply=json.loads(guest.stdout.readline())
  raw=base64.b64decode(reply['body']);self.send_response(reply['status']);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)))
  if reply['status']==401:self.send_header('WWW-Authenticate','Basic realm="KnAIghts"')
  self.end_headers();self.wfile.write(raw)
 do_GET=serve
 do_POST=serve
try:
 with ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
  server.timeout=.5
  config_path=ROOT/'private/broker.json'
  config=json.loads(config_path.read_text(encoding='utf-8'))
  config['baseUrl']=f'http://127.0.0.1:{server.server_port}/knaights-live'
  config_path.write_text(json.dumps(config),encoding='utf-8')
  (ROOT/'gateway-tunnel-ready.json').write_text(json.dumps({'pid':os.getpid(),'guestProcessPid':guest.pid,'container':cid,'port':server.server_port,'fixedDestination':'guest127.0.0.1:52773/knaights-live/v1 only'}))
  deadline=datetime.datetime.fromisoformat(json.loads((ROOT/'OWNER.json').read_text())['deadlineUtc']).timestamp()
  while time.time()<deadline and not (ROOT/'STOP_GATEWAY').exists():server.handle_request()
finally:
 guest.stdin.close()
 try:guest.wait(timeout=5)
 except subprocess.TimeoutExpired:guest.terminate();guest.wait(timeout=5)
 err.close()
 (ROOT/'gateway-tunnel-closure.json').write_text(json.dumps({'guestExited':guest.poll() is not None,'rootPid':os.getpid()}))
