(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,96706,e=>{"use strict";var r=e.i(60473),t=e.i(48283),a=e.i(78314),i=e.i(24505),s=e.i(6399),v=e.i(21348),n=e.i(85926),u=e.i(70277);let o={uniforms:{tDiffuse:{value:null},h:{value:1/512}},vertexShader:`
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
  `},l={uniforms:{tDiffuse:{value:null},v:{value:1/512}},vertexShader:`
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
  `},f=t.forwardRef(({scale:e=10,frames:r=1/0,opacity:a=1,width:i=1,height:f=1,blur:c=1,near:m=0,far:d=10,resolution:x=512,smooth:h=!0,color:g="#000000",depthWrite:p=!1,renderOrder:D,...U},y)=>{let b,j,M=t.useRef(null),w=(0,n.useThree)(e=>e.scene),S=(0,n.useThree)(e=>e.gl),C=t.useRef(null);i*=Array.isArray(e)?e[0]:e||1,f*=Array.isArray(e)?e[1]:e||1;let[T,R,P,k,L,A,G]=t.useMemo(()=>{let e=new v.WebGLRenderTarget(x,x),r=new v.WebGLRenderTarget(x,x);r.texture.generateMipmaps=e.texture.generateMipmaps=!1;let t=new v.PlaneGeometry(i,f).rotateX(Math.PI/2),a=new v.Mesh(t),s=new v.MeshDepthMaterial;s.depthTest=s.depthWrite=!1,s.onBeforeCompile=e=>{e.uniforms={...e.uniforms,ucolor:{value:new v.Color(g)}},e.fragmentShader=e.fragmentShader.replace("void main() {",`uniform vec3 ucolor;
           void main() {
          `),e.fragmentShader=e.fragmentShader.replace("vec4( vec3( 1.0 - fragCoordZ ), opacity );","vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );")};let n=new v.ShaderMaterial(o),u=new v.ShaderMaterial(l);return u.depthTest=n.depthTest=!1,[e,t,s,a,n,u,r]},[x,i,f,e,g]),B=e=>{k.visible=!0,k.material=L,L.uniforms.tDiffuse.value=T.texture,L.uniforms.h.value=e/256,S.setRenderTarget(G),S.render(k,C.current),k.material=A,A.uniforms.tDiffuse.value=G.texture,A.uniforms.v.value=e/256,S.setRenderTarget(T),S.render(k,C.current),k.visible=!1},E=0;return(0,u.useFrame)(()=>{C.current&&(r===1/0||E<r)&&(E++,b=w.background,j=w.overrideMaterial,M.current.visible=!1,w.background=null,w.overrideMaterial=P,S.setRenderTarget(T),S.render(w,C.current),B(c),h&&B(.4*c),S.setRenderTarget(null),M.current.visible=!0,w.overrideMaterial=j,w.background=b)}),t.useImperativeHandle(y,()=>M.current,[]),t.createElement("group",(0,s.default)({"rotation-x":Math.PI/2},U,{ref:M}),t.createElement("mesh",{renderOrder:D,geometry:R,scale:[1,-1,1],rotation:[-Math.PI/2,0,0]},t.createElement("meshBasicMaterial",{transparent:!0,map:T.texture,opacity:a,depthWrite:p})),t.createElement("orthographicCamera",{ref:C,args:[-i/2,i/2,f/2,-f/2,m,d]}))});var c=e.i(7890);function m({url:e,dims:t}){let a=Math.max(t.w,t.d,t.h,.1);return(0,r.jsx)("group",{scale:1.2/a,children:(0,r.jsx)(c.GlbModel,{url:e,dims:t})})}function d(){return(0,r.jsxs)("mesh",{position:[0,.5,0],children:[(0,r.jsx)("boxGeometry",{args:[.9,.9,.9]}),(0,r.jsx)("meshStandardMaterial",{color:"#9aa5a1"})]})}(0,e.i(62186).silenceKnownThreeNoise)(),e.s(["AssetDetailCanvas",0,function({url:e,dims:s}){return(0,r.jsxs)(a.Canvas,{dpr:[1,2],gl:{alpha:!0},camera:{position:[1.8,1.4,1.8],fov:40},children:[(0,r.jsx)("ambientLight",{intensity:.8}),(0,r.jsx)("hemisphereLight",{args:["#ffffff","#b9c2bb",.55]}),(0,r.jsx)("directionalLight",{position:[3,5,2],intensity:1.2}),(0,r.jsx)("directionalLight",{position:[-3,2,-2],intensity:.35}),(0,r.jsx)(c.GlbErrorBoundary,{fallback:(0,r.jsx)(d,{}),children:(0,r.jsx)(t.Suspense,{fallback:null,children:(0,r.jsx)(m,{url:e,dims:s})})}),(0,r.jsx)(f,{position:[0,0,0],opacity:.35,scale:5,blur:2.2,far:2}),(0,r.jsx)(i.OrbitControls,{autoRotate:!0,autoRotateSpeed:.8,enablePan:!1,minDistance:.8,maxDistance:5,target:[0,.5,0],makeDefault:!0})]})},"AssetPreviewCanvas",0,function({url:e,dims:s,spin:v}){return(0,r.jsxs)(a.Canvas,{dpr:[1,1.5],frameloop:v?"always":"demand",gl:{alpha:!0,powerPreference:"low-power"},camera:{position:[1.6,1.2,1.6],fov:40},children:[(0,r.jsx)("ambientLight",{intensity:.85}),(0,r.jsx)("hemisphereLight",{args:["#ffffff","#b9c2bb",.5]}),(0,r.jsx)("directionalLight",{position:[3,4,2],intensity:1.1}),(0,r.jsx)(c.GlbErrorBoundary,{fallback:(0,r.jsx)(d,{}),children:(0,r.jsx)(t.Suspense,{fallback:null,children:(0,r.jsx)(m,{url:e,dims:s})})}),(0,r.jsx)(i.OrbitControls,{autoRotate:v,autoRotateSpeed:1.2,enableZoom:!1,enablePan:!1,target:[0,.5,0],makeDefault:!0})]})},"ScaledGlb",0,m],96706)},33844,e=>{e.n(e.i(96706))}]);