"""Loopback-only session broker. Holds a restricted IRIS credential, never Docker authority."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import json,os,secrets,time,urllib.request,urllib.error,base64,threading,datetime,tempfile,subprocess
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
OPCONFIG_PATH=ROOT/'private/broker-operator.json'
OPCONFIG=json.loads(OPCONFIG_PATH.read_text()) if (ROOT/'context-live-setup.json').exists() and OPCONFIG_PATH.exists() else None
OPAUTH='Basic '+base64.b64encode((OPCONFIG['username']+':'+OPCONFIG['password']).encode()).decode() if OPCONFIG else None
OP_TOKEN=(ROOT/'private/operator-access.txt').read_text().strip() if OPCONFIG else None
OP_COOKIE=secrets.token_urlsafe(32) if OPCONFIG else None
HEALTH_PATH=ROOT/'private/broker-health.json'
HEALTH_CONFIG=json.loads(HEALTH_PATH.read_text()) if HEALTH_PATH.exists() else None
HEALTH_AUTH='Basic '+base64.b64encode((HEALTH_CONFIG['username']+':'+HEALTH_CONFIG['password']).encode()).decode() if HEALTH_CONFIG else None
HEALTH_TOKEN=(ROOT/'private/health-access.txt').read_text().strip() if HEALTH_CONFIG else None
HEALTH_COOKIE=secrets.token_urlsafe(32) if HEALTH_CONFIG else None
def write_readiness(value):
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=ROOT/'private',prefix='viewer-ready-',delete=False) as target:
        path=Path(target.name)
        try:
            if os.name=='nt':
                flags=subprocess.CREATE_NO_WINDOW
                user=subprocess.check_output(['whoami'],text=True,creationflags=flags).strip()
                subprocess.run(['icacls',str(path),'/inheritance:r','/grant:r',user+':F','SYSTEM:F'],check=True,capture_output=True,creationflags=flags)
            target.write(json.dumps(value))
        except BaseException:
            target.close();path.unlink();raise
    try:os.replace(path,ROOT/'ready.json')
    finally:path.unlink(missing_ok=True)
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
    def operator_authorized(self):
        if not OPCONFIG:self.answer(404,{'error':'WORKFLOW_NOT_CONFIGURED'});return False
        ok=any(secrets.compare_digest(x.strip(),'kotr_operator='+OP_COOKIE) for x in self.headers.get('Cookie','').split(';'))
        if not ok:self.answer(401,{'error':'OPERATOR_UNLOCK_REQUIRED'})
        return ok
    def health_authorized(self):
        if not HEALTH_CONFIG:self.answer(404,{'error':'HEALTH_NOT_CONFIGURED'});return False
        ok=any(secrets.compare_digest(x.strip(),'kotr_health='+HEALTH_COOKIE) for x in self.headers.get('Cookie','').split(';'))
        if not ok:self.answer(401,{'error':'HEALTH_UNLOCK_REQUIRED'})
        return ok
    def body(self):
        n=int(self.headers.get('Content-Length','0'))
        if not 0<n<=1024 or self.headers.get('Content-Type')!='application/json':raise ValueError('body')
        return json.loads(self.rfile.read(n))
    def upstream(self,path,obj=None,config=CONFIG,auth=AUTH):
        data=None if obj is None else json.dumps(obj).encode()
        req=urllib.request.Request(config['baseUrl']+path,data=data,headers={'Authorization':auth,'Content-Type':'application/json'},method='GET' if obj is None else 'POST')
        try:
            with UP.open(req,timeout=230) as res:status,raw=res.status,res.read(262145)
        except urllib.error.HTTPError as e:status,raw=e.code,e.read(262145)
        if len(raw)>262144:raise ValueError('upstream size')
        value=json.loads(raw)
        with (ROOT/'broker-events.jsonl').open('a') as f:f.write(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'path':path,'http':status,'requestId':obj.get('requestId') if obj else None})+'\n')
        self.answer(status,value)
    def do_GET(self):
        if not self.guard():return
        if self.path=='/api/health/sources':
            if not self.authorized() or not self.health_authorized():return
            try:self.upstream('/v1/sources',config=HEALTH_CONFIG,auth=HEALTH_AUTH)
            except Exception:self.answer(502,{'error':'HEALTH_UNAVAILABLE','state':'UNKNOWN'})
            return
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
            if self.path=='/api/health/unlock':
                if not HEALTH_CONFIG:self.answer(404,{'error':'HEALTH_NOT_CONFIGURED'});return
                if self.headers.get('X-KotR-Request')!='1':self.answer(403,{'error':'REQUEST_HEADER_REQUIRED'});return
                value=self.body()
                if not isinstance(value,dict) or set(value)!={'token'} or not isinstance(value['token'],str) or not secrets.compare_digest(value['token'],HEALTH_TOKEN):self.answer(401,{'error':'HEALTH_UNLOCK_REQUIRED'});return
                self.send_response(200);self.send_header('Set-Cookie','kotr_health='+HEALTH_COOKIE+'; HttpOnly; SameSite=Strict; Path=/');self.send_header('Content-Length','2');self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{}');return
            if self.path in ('/api/health/state','/api/health/inspect'):
                if self.headers.get('X-KotR-Request')!='1':self.answer(403,{'error':'REQUEST_HEADER_REQUIRED'});return
                if not self.health_authorized():return
                value=self.body();inspect=self.path.endswith('/inspect')
                if not isinstance(value,dict) or set(value)!=({'sourceId','requestId'} if inspect else {'sourceId'}):self.answer(400,{'error':'INVALID_HEALTH_REQUEST'});return
                source=value['sourceId']
                if not isinstance(source,str) or not 1<=len(source)<=64 or any(not(c.isascii() and (c.isalnum() or c in '-_.')) for c in source):self.answer(400,{'error':'INVALID_SOURCE_ID'});return
                if inspect:
                    request=value['requestId']
                    if not isinstance(request,str) or not 1<=len(request)<=64 or any(not(c.isascii() and (c.isalnum() or c in '-_')) for c in request):self.answer(400,{'error':'INVALID_REQUEST_ID'});return
                self.upstream('/v1/'+('inspect' if inspect else 'state'),value,HEALTH_CONFIG,HEALTH_AUTH)
                return
            if self.path=='/api/operator/unlock':
                if not OPCONFIG:self.answer(404,{'error':'WORKFLOW_NOT_CONFIGURED'});return
                if self.headers.get('X-KotR-Request')!='1':self.answer(403,{'error':'REQUEST_HEADER_REQUIRED'});return
                value=self.body()
                if not isinstance(value,dict) or set(value)!={'token'} or not isinstance(value['token'],str) or not secrets.compare_digest(value['token'],OP_TOKEN):self.answer(401,{'error':'OPERATOR_UNLOCK_REQUIRED'});return
                self.send_response(200);self.send_header('Set-Cookie','kotr_operator='+OP_COOKIE+'; HttpOnly; SameSite=Strict; Path=/');self.send_header('Content-Length','2');self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{}');return
            if self.path in ('/api/operator/queue','/api/operator/status','/api/operator/decision'):
                if self.headers.get('X-KotR-Request')!='1':self.answer(403,{'error':'REQUEST_HEADER_REQUIRED'});return
                if not self.operator_authorized():return
                value=self.body();decision=self.path.endswith('/decision')
                if not isinstance(value,dict) or set(value)!=({'requestId','action'} if decision else {'requestId'}):self.answer(400,{'error':'INVALID_WORKFLOW_REQUEST'});return
                request_id=value['requestId']
                if not isinstance(request_id,str) or not 1<=len(request_id)<=64 or any(not(c.isascii() and (c.isalnum() or c in '-_')) for c in request_id):self.answer(400,{'error':'INVALID_REQUEST_ID'});return
                if decision and value['action'] not in ('KnAIghtsReviewed','KnAIghtsDeclined'):self.answer(400,{'error':'INVALID_REVIEW_ACTION'});return
                self.upstream('/v1/'+self.path.rsplit('/',1)[-1],value,OPCONFIG,OPAUTH)
                return
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
    write_readiness({'pid':os.getpid(),'port':server.server_port,'token':TOKEN})
    while time.time()<DEADLINE and not (ROOT/'STOP_BROKER').exists():server.handle_request()
    (ROOT/'broker-closure.json').write_text(json.dumps({'stopped':True,'submittedRequestIds':sorted(REQUESTS)}))
