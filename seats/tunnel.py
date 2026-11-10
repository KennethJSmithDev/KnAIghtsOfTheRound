"""Fixed native REST transport; run separately from the account/seat web service."""
import base64,datetime,json,os,subprocess,threading,time
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--state',type=Path,required=True);root=parser.parse_args().state.resolve()
config=json.loads((root/'seat-runtime.json').read_text());cid=config['id']
info=json.loads(subprocess.check_output(['docker','inspect',cid],creationflags=subprocess.CREATE_NO_WINDOW))[0]
if info['Id']!=cid or info['Image']!=config['image'] or info['Config']['Labels'].get('org.kotr.owner')!=config['owner']:raise SystemExit('Owned fixture identity mismatch')
GUEST=r'''
import sys,json,urllib.request,urllib.error,base64
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),type('NoRedirect',(urllib.request.HTTPRedirectHandler,),{'redirect_request':lambda *a,**k:None})())
print('{"ready":true}',flush=True)
for line in sys.stdin:
 try:
  v=json.loads(line)
  if (v['method'],v['path']) not in [('GET','/kotr-seats/v1/identity'),('POST','/kotr-seats/v1/rpc')]:raise ValueError('route')
  body=base64.b64decode(v['body']) if v['method']=='POST' else None
  if body and len(body)>16000:raise ValueError('size')
  req=urllib.request.Request('http://127.0.0.1:52773'+v['path'],data=body,method=v['method'],headers={'Content-Type':'application/json','Authorization':v['authorization']})
  try:
   with opener.open(req,timeout=45) as r:status,raw=r.status,r.read(1048577)
  except urllib.error.HTTPError as e:status,raw=e.code,e.read(1048577)
  if len(raw)>1048576:raise ValueError('size')
  print(json.dumps({'status':status,'body':base64.b64encode(raw).decode()}),flush=True)
 except Exception:print('{"status":502,"body":"e30="}',flush=True)
'''
err=(root/'seat-tunnel.stderr').open('wb')
guest=subprocess.Popen(['docker','exec','--user','51773','-i',cid,'python3','-u','-c',GUEST],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,text=True,bufsize=1,creationflags=subprocess.CREATE_NO_WINDOW)
if json.loads(guest.stdout.readline()).get('ready') is not True:raise SystemExit('Native tunnel unavailable')
lock=threading.Lock()
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def serve(self):
  if self.headers.get('Host')!=f'127.0.0.1:{self.server.server_port}':self.send_error(403);return
  if self.headers.get('Origin'):self.send_error(403);return
  if (self.command,self.path) not in [('GET','/kotr-seats/v1/identity'),('POST','/kotr-seats/v1/rpc')]:self.send_error(404);return
  n=int(self.headers.get('Content-Length','0'))
  if not 0<=n<=16000:self.send_error(413);return
  value={'method':self.command,'path':self.path,'authorization':self.headers.get('Authorization',''),'body':base64.b64encode(self.rfile.read(n)).decode()}
  with lock:
   guest.stdin.write(json.dumps(value)+'\n');guest.stdin.flush();reply=json.loads(guest.stdout.readline())
  raw=base64.b64decode(reply['body']);self.send_response(reply['status']);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
 do_GET=serve
 do_POST=serve
try:
 with ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
  server.timeout=.5
  (root/'seat-tunnel-ready.json').write_text(json.dumps({'pid':os.getpid(),'guestPid':guest.pid,'port':server.server_port,'container':cid}))
  deadline=datetime.datetime.fromisoformat(config['deadlineUtc']).timestamp()
  while time.time()<deadline and not (root/'STOP_SEAT_TUNNEL').exists():server.handle_request()
finally:
 guest.stdin.close()
 try:guest.wait(timeout=5)
 except subprocess.TimeoutExpired:guest.terminate();guest.wait(timeout=5)
 err.close()
