(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,82136,e=>{"use strict";let r={wall:{roughness:.9,metalness:0,texture:"wall"},floor:{roughness:.4,metalness:0,texture:"floor"},roof:{roughness:.8,metalness:0,texture:"roof"},glass:{roughness:.1,metalness:.2,texture:"glass"}},t={modern_tropis:{label:"Modern Tropis",wall:"#f4efe4",floor:"#d9cfbd",roof:"#46564d",accent:"#3a7d6e",pbr:r},minimalis:{label:"Minimalis Putih",wall:"#fbfbfb",floor:"#e6e6e6",roof:"#cfd2d6",accent:"#8d9aa0",pbr:r},industrial:{label:"Industrial",wall:"#928d86",floor:"#6f6b65",roof:"#3b3a38",accent:"#b0703a",pbr:r},japandi:{label:"Japandi",wall:"#e8e1d4",floor:"#bb9d77",roof:"#6b5d4f",accent:"#7c8b7a",pbr:r},warm_wood:{label:"Warm Wood",wall:"#cdab7e",floor:"#a87c4f",roof:"#5a4636",accent:"#d98e44",pbr:r}},a=Object.entries(t).map(([e,r])=>({id:e,label:r.label}));e.s(["MATERIAL_PRESETS",0,t,"MATERIAL_PRESET_LIST",0,a,"SHARED_COLORS",0,{door:"#8a5a33",window:"#a9cfe3",pool:"#3f86c0",ground:"#ccd3cb",rail:"#5b5b5b",furniture:"#9b8e7d",garden:"#8fae7d",selected:"#2bb39a",hover:"#7fd0c2"},"glassMaterialProps",0,function(e){return e?{transmission:.9,ior:1.5,thickness:.4,roughness:.05,clearcoat:.6,clearcoatRoughness:.1}:null}])},96706,e=>{"use strict";var r=e.i(60473),t=e.i(48283),a=e.i(78314),i=e.i(24505),s=e.i(6399),o=e.i(21348),n=e.i(85926),l=e.i(70277);let u={uniforms:{tDiffuse:{value:null},h:{value:1/512}},vertexShader:`
      varying vec2 vUv;

      void main() {

        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

      }
  `,fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float h;

    varying vec2 vUv;

    void main() {

    	vec4 sum = vec4( 0.0 );

    	sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * h, vUv.y ) ) * 0.051;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * h, vUv.y ) ) * 0.0918;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * h, vUv.y ) ) * 0.12245;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * h, vUv.y ) ) * 0.1531;
    	sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * h, vUv.y ) ) * 0.1531;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * h, vUv.y ) ) * 0.12245;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * h, vUv.y ) ) * 0.0918;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * h, vUv.y ) ) * 0.051;

    	gl_FragColor = sum;

    }
  `},v={uniforms:{tDiffuse:{value:null},v:{value:1/512}},vertexShader:`
    varying vec2 vUv;

    void main() {

      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

    }
  `,fragmentShader:`

  uniform sampler2D tDiffuse;
  uniform float v;

  varying vec2 vUv;

  void main() {

    vec4 sum = vec4( 0.0 );

    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * v ) ) * 0.051;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * v ) ) * 0.0918;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * v ) ) * 0.12245;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * v ) ) * 0.1531;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * v ) ) * 0.1531;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * v ) ) * 0.12245;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * v ) ) * 0.0918;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * v ) ) * 0.051;

    gl_FragColor = sum;

  }
  `},f=t.forwardRef(({scale:e=10,frames:r=1/0,opacity:a=1,width:i=1,height:f=1,blur:c=1,near:d=0,far:m=10,resolution:x=512,smooth:h=!0,color:b="#000000",depthWrite:g=!1,renderOrder:p,...D},U)=>{let y,j,w=t.useRef(null),M=(0,n.useThree)(e=>e.scene),S=(0,n.useThree)(e=>e.gl),R=t.useRef(null);i*=Array.isArray(e)?e[0]:e||1,f*=Array.isArray(e)?e[1]:e||1;let[T,C,P,A,E,L,k]=t.useMemo(()=>{let e=new o.WebGLRenderTarget(x,x),r=new o.WebGLRenderTarget(x,x);r.texture.generateMipmaps=e.texture.generateMipmaps=!1;let t=new o.PlaneGeometry(i,f).rotateX(Math.PI/2),a=new o.Mesh(t),s=new o.MeshDepthMaterial;s.depthTest=s.depthWrite=!1,s.onBeforeCompile=e=>{e.uniforms={...e.uniforms,ucolor:{value:new o.Color(b)}},e.fragmentShader=e.fragmentShader.replace("void main() {",`uniform vec3 ucolor;
           void main() {
          `),e.fragmentShader=e.fragmentShader.replace("vec4( vec3( 1.0 - fragCoordZ ), opacity );","vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );")};let n=new o.ShaderMaterial(u),l=new o.ShaderMaterial(v);return l.depthTest=n.depthTest=!1,[e,t,s,a,n,l,r]},[x,i,f,e,b]),_=e=>{A.visible=!0,A.material=E,E.uniforms.tDiffuse.value=T.texture,E.uniforms.h.value=e/256,S.setRenderTarget(k),S.render(A,R.current),A.material=L,L.uniforms.tDiffuse.value=k.texture,L.uniforms.v.value=e/256,S.setRenderTarget(T),S.render(A,R.current),A.visible=!1},G=0;return(0,l.useFrame)(()=>{R.current&&(r===1/0||G<r)&&(G++,y=M.background,j=M.overrideMaterial,w.current.visible=!1,M.background=null,M.overrideMaterial=P,S.setRenderTarget(T),S.render(M,R.current),_(c),h&&_(.4*c),S.setRenderTarget(null),w.current.visible=!0,M.overrideMaterial=j,M.background=y)}),t.useImperativeHandle(U,()=>w.current,[]),t.createElement("group",(0,s.default)({"rotation-x":Math.PI/2},D,{ref:w}),t.createElement("mesh",{renderOrder:p,geometry:C,scale:[1,-1,1],rotation:[-Math.PI/2,0,0]},t.createElement("meshBasicMaterial",{transparent:!0,map:T.texture,opacity:a,depthWrite:g})),t.createElement("orthographicCamera",{ref:R,args:[-i/2,i/2,f/2,-f/2,d,m]}))});var c=e.i(7890);function d({url:e,dims:t}){let a=Math.max(t.w,t.d,t.h,.1);return(0,r.jsx)("group",{scale:1.2/a,children:(0,r.jsx)(c.GlbModel,{url:e,dims:t})})}function m(){return(0,r.jsxs)("mesh",{position:[0,.5,0],children:[(0,r.jsx)("boxGeometry",{args:[.9,.9,.9]}),(0,r.jsx)("meshStandardMaterial",{color:"#9aa5a1"})]})}(0,e.i(62186).silenceKnownThreeNoise)(),e.s(["AssetDetailCanvas",0,function({url:e,dims:s}){return(0,r.jsxs)(a.Canvas,{dpr:[1,2],gl:{alpha:!0},camera:{position:[1.8,1.4,1.8],fov:40},children:[(0,r.jsx)("ambientLight",{intensity:.8}),(0,r.jsx)("hemisphereLight",{args:["#ffffff","#b9c2bb",.55]}),(0,r.jsx)("directionalLight",{position:[3,5,2],intensity:1.2}),(0,r.jsx)("directionalLight",{position:[-3,2,-2],intensity:.35}),(0,r.jsx)(c.GlbErrorBoundary,{fallback:(0,r.jsx)(m,{}),children:(0,r.jsx)(t.Suspense,{fallback:null,children:(0,r.jsx)(d,{url:e,dims:s})})}),(0,r.jsx)(f,{position:[0,0,0],opacity:.35,scale:5,blur:2.2,far:2}),(0,r.jsx)(i.OrbitControls,{autoRotate:!0,autoRotateSpeed:.8,enablePan:!1,minDistance:.8,maxDistance:5,target:[0,.5,0],makeDefault:!0})]})},"AssetPreviewCanvas",0,function({url:e,dims:s,spin:o}){return(0,r.jsxs)(a.Canvas,{dpr:[1,1.5],frameloop:o?"always":"demand",gl:{alpha:!0,powerPreference:"low-power"},camera:{position:[1.6,1.2,1.6],fov:40},children:[(0,r.jsx)("ambientLight",{intensity:.85}),(0,r.jsx)("hemisphereLight",{args:["#ffffff","#b9c2bb",.5]}),(0,r.jsx)("directionalLight",{position:[3,4,2],intensity:1.1}),(0,r.jsx)(c.GlbErrorBoundary,{fallback:(0,r.jsx)(m,{}),children:(0,r.jsx)(t.Suspense,{fallback:null,children:(0,r.jsx)(d,{url:e,dims:s})})}),(0,r.jsx)(i.OrbitControls,{autoRotate:o,autoRotateSpeed:1.2,enableZoom:!1,enablePan:!1,target:[0,.5,0],makeDefault:!0})]})},"ScaledGlb",0,d],96706)},33844,e=>{e.n(e.i(96706))}]);