const scene = document.getElementById("scene"), experience = document.getElementById("experience"), form = document.getElementById("form-stage");
const params = new URLSearchParams(location.search);
if (params.has("record")) document.body.classList.add("recording");
let origin = performance.now(), paused = false, elapsed = 0, lastPhase = "", recording = params.has("record");
scene.start(0);
function theme(value) { scene.setAttribute("theme", value);experience.dataset.theme=value;document.getElementById("workspace").dataset.theme=value;for(const t of ["light","dark"])document.getElementById(t).setAttribute("aria-pressed",String(t===value)); }
theme(params.get("theme")==="dark"?"dark":"light");
function phaseAt(time) { return time<5000?"connecting":time<8800?"auth":time<10000?"verifying":time<11200?"profile":"ready"; }
function render(time, seek=false) {
  const phase=phaseAt(time);
  scene.setAttribute("phase",phase);scene.setAttribute("headline","");
  scene.setAttribute("detail",{connecting:"正在建立公司连接，完成后进入登录界面。",auth:"",verifying:"",profile:"正在验证账号并读取此设备上的个人空间。",ready:""}[phase]);
  experience.dataset.phase=phase;experience.dataset.introDone=String(time>=3600);
  form.hidden=false;
  form.style.opacity=["auth","verifying"].includes(phase)?"1":"0";
  form.style.visibility=["auth","verifying"].includes(phase)?"visible":"hidden";
  document.getElementById("login").innerHTML=phase==="verifying"?'<span>正在验证账号…</span><span>◌</span>':'<span>登录</span><span>↗</span>';
  if(time>=12000){scene.dataset.exit="true";experience.dataset.exit="true";}else{delete scene.dataset.exit;delete experience.dataset.exit;}
  experience.style.display=time>=13200?"none":"";
  document.getElementById("phase-label").textContent=time<2400?"01 标识序幕":time<3600?"02 光幕揭示":time<5000?"03 档案展开":time<8800?"04 登录面板":time<11200?"05 准备工作区":"06 欢迎揭幕";
  document.getElementById("scrub").value=time;document.getElementById("time").textContent=`${(time/1000).toFixed(1)} / 14.0s`;
  if (seek) {
    for(const a of experience.getAnimations({subtree:true})) {
      const n=a.animationName||"";
      const anchor = a.transitionProperty ? (time>=12000?12000:time>=11200?11200:time>=10000?10000:time>=5000?5000:3600) : n==="entry-welcome-in"||n==="entry-color-split"?11200:n==="entry-shutter"?12000:0;
      a.currentTime=Math.max(0,time-anchor);
      paused?a.pause():a.play();
    }
  }
  lastPhase=phase;
}
function tick(now){if(!paused){elapsed=Math.min(14000,now-origin);render(elapsed);if(elapsed>=14000){paused=true;document.getElementById("play").textContent="播放";}}requestAnimationFrame(tick);}
requestAnimationFrame(tick);
function seek(time){elapsed=time;origin=performance.now()-time;scene.classList.remove("entry-skipped");render(time,true);}
function restart(){paused=false;lastPhase="";origin=performance.now();elapsed=0;scene.start(0);render(0);document.getElementById("play").textContent="暂停";}
document.getElementById("play").onclick=()=>{if(elapsed>=14000){restart();return;}paused=!paused;origin=performance.now()-elapsed;for(const a of scene.getAnimations({subtree:true}))paused?a.pause():a.play();document.getElementById("play").textContent=paused?"播放":"暂停";};
document.getElementById("restart").onclick=restart;
document.getElementById("scrub").oninput=event=>seek(Number(event.target.value));
document.getElementById("light").onclick=()=>theme("light");document.getElementById("dark").onclick=()=>theme("dark");
document.getElementById("skip").onclick=()=>{seek(5000);scene.skip();};
document.getElementById("demo-form").onsubmit=event=>{event.preventDefault();seek(8800);};
window.motionPreview={restart,seek,theme,pause:()=>{paused=true;for(const a of experience.getAnimations({subtree:true}))a.pause();},duration:14000};
