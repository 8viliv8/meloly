// --- about.js : お知らせモーダル ---

export const ABOUT_VERSION = 'v1_01';

export const ABOUT_CONTENT = {
    title: '・Meloly・',
    subtitle: '育てていく作詞支援ツール',
    description: `Melolyは、【雰囲気から作る】作詞補助支援ツールです。
ある程度、歌詞の構成やフレーズの音節が決まっている場合にも特に発揮します。
一般的な作詞ツールと違い、「言葉の意味」ではなく「言葉の響き」で言葉を探すことができます。
なので、まずは【〇〇〇る】というように、すでに決まっている音数を〇で入力してください。(tabボタンですぐ〇を入力できます。)
"ここはこんな感じの母音がいい"、というときは【a】や【k】と英数字で入力してください。
候補を出したい範囲をマウスカーソルで範囲選択し、マウスのホイールを回すと、音数と母音パターンから候補として提示します。
候補は、基本的には辞書を参照しますが、画面右側のLife memoに入力しているノートより優先的に候補を出します。
なので日常で気に入った言葉やフレーズがあれば、どんどんLife memoに溜めていってください。
そうして、このmemolyはあなただけの歌詞ツールに育っていきます。`,
    features: [
        'メロディをフレーズごとにオーディオ録音したり、',
        'WORDRIPモードボタンを押してインスピレーションをつかまえたり、',
        'あいまい変換ボタンで思わぬ言葉に出会ったり、',
        '仕上げモードボタンの画面をSNSに投稿したり、',
        'life memoノートに日常の言葉を溜めておくことで自分らしさを歌詞に加えることもできます。',
    ],
    upcoming: [
        'ドラムロール候補の拡充',
        '英語歌詞対応',
        'インスピレーションパネルにイメージフラッシュモードを追加',
        '録音したオーディオの保存化',
        'コード入力画面の実装',
        '入力したBMP、KEY、コードのMIDI書き出し機能',
        'PWA対応（スマホアプリ化）',
        'JSONエクスポート / インポート',
        'life memo の iPhone&android 連携',
    ],
    contact: {
        name: 'reimei',
        xId: '@4cqz_01',
        xUrl: 'https://x.com/4cqz_01',
    }
};

export function showAboutModal(){
    const existing=document.getElementById('about-modal-overlay');
    if(existing){existing.remove();return;}

    const overlay=document.createElement('div');
    overlay.id='about-modal-overlay';
    overlay.style.cssText='position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.4);backdrop-filter:blur(4px);z-index:8000;display:flex;align-items:center;justify-content:center;';

    const modal=document.createElement('div');
    modal.style.cssText='background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:28px 32px;max-width:420px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.15);position:relative;';

    // 閉じるボタン
    const closeBtn=document.createElement('button');
    closeBtn.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>';
    closeBtn.style.cssText='position:absolute;top:14px;right:14px;background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:4px;display:flex;align-items:center;transition:color .15s;';
    closeBtn.onmouseenter=()=>closeBtn.style.color='var(--text-main)';
    closeBtn.onmouseleave=()=>closeBtn.style.color='var(--text-muted)';
    closeBtn.onclick=()=>overlay.remove();

    // タイトル
    const title=document.createElement('div');
    title.style.cssText='font-family:var(--font-serif);font-size:18px;font-weight:400;color:var(--text-main);letter-spacing:3px;margin-bottom:2px;';
    title.textContent=ABOUT_CONTENT.title;

    const subtitle=document.createElement('div');
    subtitle.style.cssText='font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:16px;';
    subtitle.textContent=ABOUT_CONTENT.subtitle+'　'+ABOUT_VERSION;

    const divider=()=>{
        const d=document.createElement('div');
        d.style.cssText='height:1px;background:var(--border);margin:14px 0;';
        return d;
    };

    // アプリ説明
    const desc=document.createElement('div');
    desc.style.cssText='font-size:11px;color:var(--text-main);line-height:1.9;margin-bottom:10px;';
    desc.textContent=ABOUT_CONTENT.description;

    const featLabel=document.createElement('div');
    featLabel.style.cssText='font-size:9px;color:var(--text-muted);letter-spacing:1.5px;font-weight:700;margin-bottom:6px;';
    featLabel.textContent='制作に詰まったときは——';

    const featList=document.createElement('div');
    featList.style.cssText='display:flex;flex-direction:column;gap:3px;margin-bottom:4px;';
    ABOUT_CONTENT.features.forEach(f=>{
        const item=document.createElement('div');
        item.style.cssText='font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;';
        item.innerHTML=`<span style="color:var(--accent);">·</span> ${f}`;
        featList.appendChild(item);
    });

    // 今後の実装予定
    const upLabel=document.createElement('div');
    upLabel.style.cssText='font-size:9px;color:var(--text-muted);letter-spacing:1.5px;font-weight:700;margin-bottom:6px;';
    upLabel.textContent='今後実装予定';

    const upList=document.createElement('div');
    upList.style.cssText='display:flex;flex-direction:column;gap:3px;';
    ABOUT_CONTENT.upcoming.forEach(u=>{
        const item=document.createElement('div');
        item.style.cssText='font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;';
        item.innerHTML=`<span style="color:var(--accent);">·</span> ${u}`;
        upList.appendChild(item);
    });

    // 連絡先
    const contactLabel=document.createElement('div');
    contactLabel.style.cssText='font-size:9px;color:var(--text-muted);letter-spacing:1.5px;font-weight:700;margin-bottom:8px;';
    contactLabel.textContent='ご意見・ご要望・バグ報告など';

    const contactDesc=document.createElement('div');
    contactDesc.style.cssText='font-size:11px;color:var(--text-muted);margin-bottom:12px;line-height:1.8;';
    contactDesc.textContent='お気軽にXでメッセージを送ってください。';

    // QRコード（Google Charts API）
    const qrWrap=document.createElement('div');
    qrWrap.style.cssText='display:flex;align-items:center;gap:16px;';

    const qrImg=document.createElement('img');
    const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(ABOUT_CONTENT.contact.xUrl)}`;
    qrImg.src=qrUrl;
    qrImg.style.cssText='width:80px;height:80px;border-radius:6px;border:1px solid var(--border);';
    qrImg.alt='X QRコード';

    const xInfo=document.createElement('div');
    xInfo.style.cssText='display:flex;flex-direction:column;gap:4px;';

    const xName=document.createElement('div');
    xName.style.cssText='font-size:13px;color:var(--text-main);font-weight:500;';
    xName.textContent=ABOUT_CONTENT.contact.name;

    const xId=document.createElement('a');
    xId.href=ABOUT_CONTENT.contact.xUrl;
    xId.target='_blank';
    xId.style.cssText='font-size:11px;color:var(--accent);text-decoration:none;letter-spacing:.5px;';
    xId.textContent=ABOUT_CONTENT.contact.xId;
    xId.onmouseenter=()=>xId.style.textDecoration='underline';
    xId.onmouseleave=()=>xId.style.textDecoration='none';

    xInfo.appendChild(xName);
    xInfo.appendChild(xId);
    qrWrap.appendChild(qrImg);
    qrWrap.appendChild(xInfo);

    modal.appendChild(closeBtn);
    modal.appendChild(title);
    modal.appendChild(subtitle);
    modal.appendChild(divider());
    modal.appendChild(desc);
    modal.appendChild(featLabel);
    modal.appendChild(featList);
    modal.appendChild(divider());
    modal.appendChild(upLabel);
    modal.appendChild(upList);
    modal.appendChild(divider());
    modal.appendChild(contactLabel);
    modal.appendChild(contactDesc);
    modal.appendChild(qrWrap);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // オーバーレイクリックで閉じる
    overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
}
