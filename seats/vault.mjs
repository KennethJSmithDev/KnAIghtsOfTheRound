import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatGPTAccount } from './account.mjs';

export class Vault {
  constructor(directory) { this.directory=directory; this.profiles=new Map(); this.metadata=[]; this.serial=Promise.resolve(); }
  async init() {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    this.lock=join(this.directory,'vault.lock');
    const handle=await open(this.lock,'wx',0o600);await handle.writeFile(String(process.pid));await handle.close();
    try {
      try {this.host=(await readFile(join(this.directory,'host-id'),'utf8')).trim()}
      catch(e){if(e.code!=='ENOENT')throw e;this.host='urn:uuid:'+randomUUID();await writeFile(join(this.directory,'host-id'),this.host,{flag:'wx',mode:0o600})}
      if(!/^urn:uuid:[a-f0-9-]{36}$/.test(this.host))throw new Error('Invalid host identity.');
      try {this.metadata=JSON.parse(await readFile(join(this.directory,'profiles.json'),'utf8'))}
      catch(e){if(e.code!=='ENOENT')throw e}
      for(const entry of this.metadata){if(!/^[a-f0-9-]{36}$/.test(entry.id)||typeof entry.owner!=='string')throw new Error('Invalid saved account record.');await this.load(entry)}
    } catch(e){await this.close();throw e}
  }
  async save() {const temporary=join(this.directory,randomUUID()+'.tmp');await writeFile(temporary,JSON.stringify(this.metadata),{flag:'wx',mode:0o600});await rename(temporary,join(this.directory,'profiles.json'))}
  async load(entry) {
    const owner=createHash('sha256').update(entry.owner).digest('hex');
    const account=new ChatGPTAccount(join(this.directory,owner,entry.id),this.host);
    await account.init();this.profiles.set(entry.id,account);return account;
  }
  async add(owner,label) {
    const operation=this.serial.then(async()=>{
      if(typeof label!=='string'||label.length<1||label.length>64||this.metadata.filter(p=>p.owner===owner).length>=8)throw new Error('Account label or limit is invalid.');
      const entry={id:randomUUID(),owner,label};const account=await this.load(entry);
      this.metadata.push(entry);await this.save();return {...entry,...account.status()};
    });
    this.serial=operation.catch(()=>{});return operation;
  }
  get(owner,id) {if(!this.metadata.some(p=>p.owner===owner&&p.id===id))throw new Error('Account not found.');return this.profiles.get(id)}
  list(owner) {return this.metadata.filter(p=>p.owner===owner).map(p=>({id:p.id,label:p.label,...this.get(owner,p.id).status()}))}
  async close(){await this.serial;await Promise.all([...this.profiles.values()].map(p=>p.close()));if(this.lock)await unlink(this.lock)}
}
