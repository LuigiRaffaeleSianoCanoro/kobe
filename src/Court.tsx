import { useEffect, useRef } from "react";

const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const FS = `precision highp float;
uniform vec2 r;uniform float t;uniform vec3 A;uniform vec3 B;uniform float L;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+1.7;a*=.5;}return v;}
float ln(float d,float w){return 1.-smoothstep(w,w+1.5/r.y,abs(d));}
void main(){
 vec2 s=gl_FragCoord.xy/r;float asp=r.x/r.y;vec2 uv=vec2(s.x*asp,s.y);
 vec2 p=uv*14.;float row=floor(p.y);
 float px=p.x/4.+h(vec2(row,3.1));float col=floor(px);vec2 id=vec2(col,row);
 vec2 lp=vec2(fract(px),fract(p.y));
 float g=fbm(vec2(p.x*.45,p.y*9.)+id*13.7);
 float rings=.5+.5*sin(p.y*30.+g*9.+h(id)*30.);
 vec3 c=mix(vec3(.47,.27,.13),vec3(.80,.55,.31),.35+.5*h(id+.3));
 c*=.82+.3*g;c=mix(c,c*.86,rings*.35);
 float seam=smoothstep(0.,.05,lp.y)*smoothstep(1.,.95,lp.y)*smoothstep(0.,.006,lp.x)*smoothstep(1.,.994,lp.x);
 c*=mix(.6,1.,seam);
 vec2 q=vec2(uv.x-asp*.5,uv.y);
 float paint=step(abs(q.x),.24)*step(q.y,.58);
 c=mix(c,c*.5+A*.5,paint*.55*L);
 float li=ln(length(q-vec2(0.,-.02))-.86,.003);
 li=max(li,ln(length(q-vec2(0.,.58))-.24,.003)*step(.58,q.y));
 li=max(li,ln(abs(q.x)-.24,.003)*step(q.y,.58));
 li=max(li,ln(q.y-.58,.003)*step(abs(q.x),.24));
 c=mix(c,vec3(.95,.92,.85),li*.55*L);
 float g1=exp(-3.2*length(s-vec2(.18+.06*sin(t*.21),.92)));
 float g2=exp(-3.*length(s-vec2(.88,.12+.05*cos(t*.17))));
 float sw=exp(-pow((s.x+s.y*.3-fract(t*.025)*2.2+.4)*5.,2.))*.06;
 c*=.48;c+=A*g2*.6+B*g1*.38+sw;
 c*=1.-.55*pow(length(s-.5)*1.2,2.);
 gl_FragColor=vec4(c,1.);}`;

/** Wood floor + court lines from the design WebGL shader. Palette default Purple & Gold. */
export function Court() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const gl = c.getContext("webgl");
    if (!gl) return;
    const mk = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const pr = gl.createProgram();
    if (!pr) return;
    const v = mk(gl.VERTEX_SHADER, VS);
    const f = mk(gl.FRAGMENT_SHADER, FS);
    if (!v || !f) return;
    gl.attachShader(pr, v);
    gl.attachShader(pr, f);
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(pr, "r");
    const uT = gl.getUniformLocation(pr, "t");
    const uA = gl.getUniformLocation(pr, "A");
    const uB = gl.getUniformLocation(pr, "B");
    const uL = gl.getUniformLocation(pr, "L");
    const A: [number, number, number] = [0.42, 0.2, 0.72];
    const B: [number, number, number] = [1, 0.72, 0.15];
    const t0 = performance.now();
    let raf = 0;
    const loop = () => {
      const d = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor((c.clientWidth || window.innerWidth) * d));
      const hh = Math.max(1, Math.floor((c.clientHeight || window.innerHeight) * d));
      if (c.width !== w || c.height !== hh) {
        c.width = w;
        c.height = hh;
        gl.viewport(0, 0, w, hh);
      }
      gl.uniform2f(uR, w, hh);
      gl.uniform1f(uT, (performance.now() - t0) / 1000);
      gl.uniform3fv(uA, A);
      gl.uniform3fv(uB, B);
      gl.uniform1f(uL, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="court" />;
}
