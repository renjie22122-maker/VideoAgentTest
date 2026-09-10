'use client';
// Supplier outputs do not include a transcript. Do not fabricate captions from the script.
export function RawClip({url,title,dialogue}:{url:string;title:string;dialogue:string}){
 const label=url.startsWith('/api/studio-videos/')?'本地组装长镜头 · 接缝待审查':'原始生成素材';
 return <figure><figcaption>{title} · {label}{dialogue?'；剧本参考对白：'+dialogue:'；剧本未设置对白'}</figcaption>{/* Accurate caption generation belongs to the audio/transcription adapter. */}
 {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
 <video controls src={url} aria-label={title+label}/></figure>;
}
