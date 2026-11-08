"""Loopback-only session broker. Holds a restricted IRIS credential, never Docker authority."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import json,os,secrets,time,urllib.request,urllib.error,base64,threading,datetime
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--state',type=Path,required=True)
ROOT=parser.parse_args().state.resolve()
SOURCE=Path(__file__).resolve().parents[1]
CONFIG=json.loads((ROOT/'private/broker.json').read_text())
DIST=SOURCE/'visual/dist'
TOKEN=secrets.token_urlsafe(32)
COOKIE=secrets.token_urlsafe(32)
LOCK=threading.Lock()
REQUESTS=set()
DEADLINE=datetime.datetime.fromisoformat(json.loads((ROOT/'OWNER.json').read_text())['deadlineUtc']).timestamp()
UP=urllib.request.build_opener(urllib.request.ProxyHandler({}),type('NoRedirect',(urllib.request.HTTPRedirectHandler,),{'redirect_request':lambda *a,**k:None})())
AUTH='Basic '+base64.b64encode((CONFIG['username']+':'+CONFIG['password']).encode()).decode()
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**k):super().__init__(*a,directory=str(DIST),**k)
    def log_message(self,*a):pass
    def list_directory(self,path):self.send_error(404);return None
    def end_headers(self):
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'")
        super().end_headers()
    def answer(self,status,obj):
        data=json.dumps(obj,separators=(',',':')).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def guard(self,write=False):
        if self.headers.get('Host')!=f'127.0.0.1:{self.server.server_port}':self.answer(403,{'error':'HOST_REJECTED'});return False
        if write and self.headers.get('Origin')!=f'http://127.0.0.1:{self.server.server_port}':self.answer(403,{'error':'ORIGIN_REJECTED'});return False
        if time.time()>=DEADLINE:self.answer(503,{'error':'ALLOWANCE_EXPIRED'});return False
        return True
    def authorized(self):
        value=self.headers.get('Cookie','')
        ok=any(secrets.compare_digest(x.strip(),'kotr_session='+COOKIE) for x in value.split(';'))
        if not ok:self.answer(401,{'error':'LOCAL_SESSION_REQUIRED'})
        return ok
    def body(self):
        n=int(self.headers.get('Content-Length','0'))
        if not 0<n<=1024 or self.headers.get('Content-Type')!='application/json':raise ValueError('body')
        return json.loads(self.rfile.read(n))
    def upstream(self,path,obj=None):
        data=None if obj is None else json.dumps(obj).encode()
        req=urllib.request.Request(CONFIG['baseUrl']+path,data=data,headers={'Authorization':AUTH,'Content-Type':'application/json'},method='GET' if obj is None else 'POST')
        try:
            with UP.open(req,timeout=230) as res:status,raw=res.status,res.read(262145)
        except urllib.error.HTTPError as e:status,raw=e.code,e.read(262145)
        if len(raw)>262144:raise ValueError('upstream size')
        value=json.loads(raw)
        with (ROOT/'broker-events.jsonl').open('a') as f:f.write(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'path':path,'http':status,'requestId':obj.get('requestId') if obj else None})+'\n')
        self.answer(status,value)
    def do_GET(self):
        if not self.guard():return
        if self.path=='/api/session':
            if not self.authorized():return
            try:self.upstream('/v1/session')
            except Exception:self.answer(502,{'error':'SERVICE_UNAVAILABLE','state':'UNKNOWN'})
            return
        if self.path.startswith('/api/') or '..' in self.path or '?' in self.path or '%' in self.path:self.send_error(404);return
        super().do_GET()
    def do_POST(self):
        if not self.guard(True):return
        try:
            if self.path=='/api/bootstrap':
                value=self.body()
                if set(value)!= {'token'} or not isinstance(value['token'],str) or not secrets.compare_digest(value['token'],TOKEN):self.answer(401,{'error':'LOCAL_SESSION_REQUIRED'});return
                self.send_response(200);self.send_header('Set-Cookie','kotr_session='+COOKIE+'; HttpOnly; SameSite=Strict; Path=/');self.send_header('Content-Length','2');self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{}');return
            if not self.authorized():return
            if self.path!='/api/session/run':self.answer(404,{'error':'NOT_FOUND'});return
            if self.headers.get('X-KotR-Request')!='1':self.answer(403,{'error':'REQUEST_HEADER_REQUIRED'});return
            value=self.body()
            if not isinstance(value,dict) or set(value)!= {'caseId','requestId'} or value['caseId'] not in ('synthetic-a','synthetic-b') or not isinstance(value['requestId'],str) or not 1<=len(value['requestId'])<=64 or any(not(c.isascii() and (c.isalnum() or c=='-')) for c in value['requestId']):self.answer(400,{'error':'INVALID_SYNTHETIC_REQUEST'});return
            with LOCK:
                if value['requestId'] not in REQUESTS:
                    if len(REQUESTS)>=2:self.answer(429,{'error':'SUBMISSION_ALLOWANCE_EXHAUSTED'});return
                    REQUESTS.add(value['requestId'])
            self.upstream('/v1/run',value)
        except ValueError:self.answer(400,{'error':'INVALID_REQUEST'})
        except Exception:self.answer(502,{'error':'SERVICE_UNAVAILABLE','state':'UNKNOWN'})
with ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
    server.timeout=.5
    (ROOT/'ready.json').write_text(json.dumps({'pid':os.getpid(),'port':server.server_port,'token':TOKEN}))
    while time.time()<DEADLINE and not (ROOT/'STOP_BROKER').exists():server.handle_request()
    (ROOT/'broker-closure.json').write_text(json.dumps({'stopped':True,'submittedRequestIds':sorted(REQUESTS)}))
