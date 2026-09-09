// --- Audio Module ---
export const aud={};
export const recState={};
export const audBlob={};  // ZIP書き出し用にblobを保持

export function fmt(s){return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;}

export function toggleMenu(id){
    const m=document.getElementById('m-'+id);
    const o=m.classList.contains('open');
    document.querySelectorAll('.note-menu').forEach(x=>x.classList.remove('open'));
    if(!o)m.classList.add('open');
}

export function importAudio(id){
    document.querySelectorAll('.note-menu').forEach(x=>x.classList.remove('open'));
    document.getElementById('f-'+id).click();
}

function bindAudioEvents(id,a){
    a.addEventListener('timeupdate',()=>{
        if(!a.duration)return;
        document.getElementById('sk-'+id).value=(a.currentTime/a.duration)*100;
        document.getElementById('td-'+id).textContent=`${fmt(a.currentTime)} / ${fmt(a.duration)}`;
    });
    a.addEventListener('play',()=>document.getElementById('pw-'+id).classList.add('active'));
    a.addEventListener('pause',()=>document.getElementById('pw-'+id).classList.remove('active'));
    a.addEventListener('ended',()=>{
        if(!a.loop){
            document.getElementById('pi-'+id).style.display='block';
            document.getElementById('pau-'+id).style.display='none';
            document.getElementById('pw-'+id).classList.remove('active');
        }
    });
}

function setAudioUI(id,name){
    const fn=document.getElementById('fn-'+id);
    fn.textContent=name;
    fn.setAttribute('data-tip-up',name);
    document.getElementById('t-'+id).style.display='none';
    document.getElementById('ex-'+id).classList.add('has-audio');
}

export function onFile(id,inp){
    const file=inp.files[0];if(!file)return;
    if(aud[id])aud[id].pause();
    audBlob[id]=file;
    const a=new Audio(URL.createObjectURL(file));
    a.volume=.8;aud[id]=a;
    setAudioUI(id,file.name);
    bindAudioEvents(id,a);
}

export function startRec(id){
    document.querySelectorAll('.note-menu').forEach(x=>x.classList.remove('open'));
    toggleRecording(id);
}

export async function toggleRecording(id){
    const btn=document.getElementById('rc-'+id);
    if(recState[id]&&recState[id].active){
        recState[id].mediaRecorder.stop();
    }else{
        try{
            const stream=await navigator.mediaDevices.getUserMedia({audio:true});
            const options=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ?{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:128000}
                :{audioBitsPerSecond:128000};
            const mediaRecorder=new MediaRecorder(stream,options);
            const chunks=[];
            recState[id]={active:true,mediaRecorder,stream};
            mediaRecorder.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
            mediaRecorder.onstop=()=>{
                const blob=new Blob(chunks,{type:'audio/webm'});
                audBlob[id]=blob;  // blobを保持
                const url=URL.createObjectURL(blob);
                stream.getTracks().forEach(t=>t.stop());
                recState[id].active=false;
                btn.classList.remove('recording');
                if(aud[id])aud[id].pause();
                const a=new Audio(url);
                a.volume=.8;aud[id]=a;
                setAudioUI(id,'録音済み');
                bindAudioEvents(id,a);
            };
            mediaRecorder.start();
            btn.classList.add('recording');
            document.getElementById('t-'+id).style.display='none';
            document.getElementById('ex-'+id).classList.add('has-audio');
            document.getElementById('fn-'+id).textContent='録音中...';
        }catch(e){
            alert('マイクへのアクセスが許可されていません。');
        }
    }
}

export function togglePlay(id){
    const a=aud[id];if(!a)return;
    if(a.paused){
        a.play();
        document.getElementById('pi-'+id).style.display='none';
        document.getElementById('pau-'+id).style.display='block';
    }else{
        a.pause();
        document.getElementById('pi-'+id).style.display='block';
        document.getElementById('pau-'+id).style.display='none';
    }
}

export function toggleRepeat(id){
    const on=document.getElementById('rp-'+id).classList.toggle('on');
    if(aud[id])aud[id].loop=on;
}

export function seekAudio(id,v){
    const a=aud[id];if(!a||!a.duration)return;
    a.currentTime=(v/100)*a.duration;
}

export function setVol(id,v){if(aud[id])aud[id].volume=v/100;}

export function exportAudio(id){
    const blob=audBlob[id];
    if(!blob){alert('エクスポートできる音声がありません。');return;}
    const fn=document.getElementById('fn-'+id);
    const name=(fn&&fn.textContent&&fn.textContent!=='—')?fn.textContent:'recording';
    const filename=name.endsWith('.webm')?name:name.replace(/\.[^.]+$/,'')+'.webm';
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=filename;a.click();
    URL.revokeObjectURL(url);
}

export function delAudio(id){
    if(aud[id]){aud[id].pause();delete aud[id];}
    if(audBlob[id])delete audBlob[id];
    if(recState[id]&&recState[id].active){
        recState[id].mediaRecorder.stop();
        recState[id].stream.getTracks().forEach(t=>t.stop());
    }
    delete recState[id];
    document.getElementById('ex-'+id).classList.remove('has-audio');
    document.getElementById('t-'+id).style.display='block';
    document.getElementById('pw-'+id).classList.remove('active');
    document.getElementById('pi-'+id).style.display='block';
    document.getElementById('pau-'+id).style.display='none';
    document.getElementById('sk-'+id).value=0;
    document.getElementById('td-'+id).textContent='0:00 / 0:00';
    document.getElementById('fn-'+id).textContent='—';
    document.getElementById('rp-'+id).classList.remove('on');
    document.getElementById('rc-'+id).classList.remove('recording');
}

// ZIP読み込み時に音声を復元する
export function restoreAudio(id,blob,name){
    if(aud[id])aud[id].pause();
    audBlob[id]=blob;
    const url=URL.createObjectURL(blob);
    const a=new Audio(url);
    a.volume=.8;aud[id]=a;
    const fn=document.getElementById('fn-'+id);
    if(fn){
        fn.textContent=name||'録音済み';
        fn.setAttribute('data-tip-up',name||'録音済み');
        document.getElementById('t-'+id).style.display='none';
        document.getElementById('ex-'+id).classList.add('has-audio');
        const bindFn=()=>{
            a.addEventListener('timeupdate',()=>{
                if(!a.duration)return;
                document.getElementById('sk-'+id).value=(a.currentTime/a.duration)*100;
                document.getElementById('td-'+id).textContent=`${fmt(a.currentTime)} / ${fmt(a.duration)}`;
            });
            a.addEventListener('play',()=>document.getElementById('pw-'+id).classList.add('active'));
            a.addEventListener('pause',()=>document.getElementById('pw-'+id).classList.remove('active'));
            a.addEventListener('ended',()=>{
                if(!a.loop){
                    document.getElementById('pi-'+id).style.display='block';
                    document.getElementById('pau-'+id).style.display='none';
                    document.getElementById('pw-'+id).classList.remove('active');
                }
            });
        };
        bindFn();
    }
}
