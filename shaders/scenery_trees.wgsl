// Species, growth and geometry for the second scenery pass (docs/SCENERY.md, "Second pass"). Everything here is generated
// on the GPU from compact parameter tables: a recursive branch skeleton per tree variant (trunk, limbs, branches, twigs),
// tubes and leaf cards on fixed template topologies at three levels of detail, rock families on cube-sphere grids, the
// ground-cover meshes, and a procedural twig-and-leaf card atlas per species. No imported model or bitmap.
// Ideas only from Weber & Penn (1995) (shape ratios, per-order parameters), Prusinkiewicz & Lindenmayer (phyllotaxis) and
// Palubicki et al. (2009) (tropisms, apical control); no code from any tree generator.

// ---- Template topologies. Every mesh class is a list of grid patches (count, columns, rows): a tube is a grid whose
// columns run around it (with a seam column), a card one quad, a cube-sphere face a square grid. The index buffer holds one
// copy per class; vertices are stored per variant. An index is (class << 24) | vertex within the variant.
const SC_WORDS:u32=8u;
const SC_ROCK_VARIANTS:u32=24u;
const SC_LEAF_LAYERS:u32=16u;
const SC_CLASSES:u32=10u;
// Materials carried by a vertex.
const SM_NONE:u32=0u;const SM_BARK:u32=1u;const SM_LEAF:u32=2u;const SM_ROCK:u32=3u;const SM_GRASS:u32=4u;const SM_REED:u32=5u;const SM_PEBBLE:u32=6u;const SM_FERN:u32=7u;const SM_FLOWER:u32=8u;const SM_DEAD:u32=9u;
fn sc_group(c:u32,g:u32)->vec3<u32>{
 switch c{
  case 0u:{switch g{case 0u:{return vec3<u32>(1u,12u,20u);}case 1u:{return vec3<u32>(48u,7u,8u);}case 2u:{return vec3<u32>(192u,5u,4u);}case 3u:{return vec3<u32>(768u,3u,1u);}case 4u:{return vec3<u32>(2048u,1u,1u);}default:{}}}
  case 1u:{switch g{case 0u:{return vec3<u32>(1u,8u,10u);}case 1u:{return vec3<u32>(48u,5u,4u);}case 2u:{return vec3<u32>(192u,3u,2u);}case 3u:{return vec3<u32>(512u,1u,1u);}default:{}}}
  case 2u:{switch g{case 0u:{return vec3<u32>(1u,5u,5u);}case 1u:{return vec3<u32>(48u,3u,1u);}case 2u:{return vec3<u32>(128u,1u,1u);}default:{}}}
  case 3u:{if g==0u{return vec3<u32>(6u,16u,16u);}}
  case 4u:{if g==0u{return vec3<u32>(6u,6u,6u);}}
  case 5u:{switch g{case 0u:{return vec3<u32>(20u,1u,4u);}case 1u:{return vec3<u32>(3u,1u,1u);}default:{}}}
  case 6u:{switch g{case 0u:{return vec3<u32>(10u,1u,4u);}case 1u:{return vec3<u32>(4u,1u,2u);}default:{}}}
  case 7u:{if g==0u{return vec3<u32>(36u,2u,2u);}}
  case 8u:{if g==0u{return vec3<u32>(7u,1u,3u);}}
  case 9u:{switch g{case 0u:{return vec3<u32>(3u,3u,2u);}case 1u:{return vec3<u32>(28u,1u,1u);}default:{}}}
  case 10u:{if g==0u{return vec3<u32>(8u,1u,4u);}}
  default:{}
 }
 return vec3<u32>(0u);
}
// Vertices per variant, quads, first index and variants of each class (checked against sc_group by a Rust test).
fn sc_class_verts(c:u32)->u32{switch c{case 0u:{return 23825u;}case 1u:{return 5891u;}case 2u:{return 932u;}case 3u:{return 1734u;}case 4u:{return 294u;}case 5u:{return 212u;}case 6u:{return 124u;}case 7u:{return 324u;}case 8u:{return 56u;}case 9u:{return 148u;}default:{return 0u;}}}
fn sc_class_quads(c:u32)->u32{switch c{case 0u:{return 11120u;}case 1u:{return 2704u;}case 2u:{return 297u;}case 3u:{return 1536u;}case 4u:{return 216u;}case 5u:{return 83u;}case 6u:{return 48u;}case 7u:{return 144u;}case 8u:{return 21u;}case 9u:{return 46u;}case 10u:{return 32u;}default:{return 0u;}}}
fn sc_class_first(c:u32)->u32{var s=0u;for(var k=0u;k<c;k++){s+=sc_class_quads(k)*6u;}return s;}
const SC_TEMPLATE_QUADS:u32=16247u;
fn sc_tree_ages()->u32{return max(1u,min(3u,f.tier_d.y));}
fn sc_tree_variants()->u32{return SC_SPECIES*sc_tree_ages();}
fn sc_variants()->u32{return sc_tree_variants()+SC_ROCK_VARIANTS;}
fn sc_class_variants(c:u32)->u32{switch c{case 0u,1u,2u:{return sc_tree_variants();}case 3u,4u:{return SC_ROCK_VARIANTS;}case 5u:{return 8u;}case 6u:{return 4u;}case 7u:{return 8u;}case 8u:{return 4u;}case 9u:{return 4u;}default:{return 0u;}}}
fn sc_class_vertex_base(c:u32)->u32{var s=0u;for(var k=0u;k<c;k++){s+=sc_class_verts(k)*sc_class_variants(k);}return s;}
struct ScLoc {g:u32,p:u32,i:u32,j:u32,cols:u32,rows:u32}
fn sc_locate(c:u32,lv:u32)->ScLoc{
 var base=0u;
 for(var g=0u;g<6u;g++){let d=sc_group(c,g);if d.x==0u{break;}let per=(d.y+1u)*(d.z+1u);let n=d.x*per;if lv<base+n{let r=lv-base;let q=r%per;return ScLoc(g,r/per,q%(d.y+1u),q/(d.y+1u),d.y,d.z);}base+=n;}
 return ScLoc(99u,0u,0u,0u,1u,1u);
}

// ---- Packed vertex: 8 words. Position 3 x 21 bits over [-2, 2] model units, octahedral normal and tangent, two unorm16
// coordinates, material/order/occlusion/phase/aux, wind weights and the tube radius (half floats).
struct ScV {p:vec3<f32>,n:vec3<f32>,t:vec3<f32>,uv:vec2<f32>,material:u32,order:u32,ao:f32,phase:f32,aux:u32,bend:f32,flutter:f32,radius:f32,extra:f32}
fn sc_oct16(v:vec3<f32>)->u32{let l=length(v);if l<1e-9{return pack2x16unorm(vec2<f32>(0.5,0.5));}return pack2x16unorm(sc_oct_encode(v/l));}
fn sc_unoct16(w:u32)->vec3<f32>{return sc_oct_decode(unpack2x16unorm(w));}
fn sc_pack(v:ScV)->array<u32,8>{
 let q=vec3<u32>(clamp((v.p+2.0)*0.25,vec3<f32>(0.0),vec3<f32>(1.0))*2097151.0+0.5);
 var w:array<u32,8>;
 w[0]=q.x|(q.y<<21u);w[1]=(q.y>>11u)|(q.z<<10u);w[2]=sc_oct16(v.n);w[3]=sc_oct16(v.t);w[4]=pack2x16unorm(clamp(v.uv,vec2<f32>(0.0),vec2<f32>(1.0)));
 w[5]=(v.material&15u)|((v.order&3u)<<4u)|(u32(clamp(v.ao,0.0,1.0)*255.0+0.5)<<6u)|(u32(fract(v.phase)*255.0+0.5)%256u<<14u)|((v.aux&1023u)<<22u);
 w[6]=pack2x16float(vec2<f32>(v.bend,v.flutter));w[7]=pack2x16float(vec2<f32>(v.radius,v.extra));
 return w;
}
fn sc_unpack(w:array<u32,8>)->ScV{
 let q=vec3<u32>(w[0]&0x1fffffu,(w[0]>>21u)|((w[1]&0x3ffu)<<11u),(w[1]>>10u)&0x1fffffu);
 let wind=unpack2x16float(w[6]);let extra=unpack2x16float(w[7]);
 return ScV(vec3<f32>(q)/2097151.0*4.0-2.0,sc_unoct16(w[2]),sc_unoct16(w[3]),unpack2x16unorm(w[4]),w[5]&15u,(w[5]>>4u)&3u,f32((w[5]>>6u)&255u)/255.0,f32((w[5]>>14u)&255u)/255.0,w[5]>>22u,wind.x,wind.y,extra.x,extra.y);
}

// Age classes: young, mature, old. On a tier with fewer ages the classes spread over the same range.
fn sc_age_value(age:u32)->f32{let n=sc_tree_ages();if n==1u{return 1.0;}return f32(age)/f32(n-1u)*2.0;}
fn sc_species(s:u32,age:u32)->ScSpecies{
 var p=sc_species_base(s);let a=sc_age_value(age);
 let young=1.0-min(a,1.0);let old=max(a-1.0,0.0);
 p.limbs=p.limbs*(1.0-0.38*young+0.1*old);p.width=p.width*(1.0-0.18*young+0.22*old);p.base=p.base*(1.0-0.45*young+0.3*old);
 p.gnarl=p.gnarl*(1.0-0.5*young+0.7*old);p.radius=p.radius*(1.0-0.25*young+0.3*old);p.dead=p.dead+0.18*old;p.lean=p.lean*(1.0+old);
 p.card=p.card*(1.0-0.15*young);
 // An old pine flattens its crown into an umbrella; an old oak spreads lower and wider.
 if s==SC_PINE&&old>0.5{p.shape=7u;p.base=min(p.base*1.15,0.78);p.angle0=1.2;p.angle1=0.9;}
 if s==SC_OAK{p.angle0=p.angle0+0.15*old;}
 return p;
}
fn sc_shape_ratio(shape:u32,r:f32)->f32{
 switch shape{
  case 0u:{return 0.2+0.8*r;}
  case 1u:{return 0.2+0.8*sin(3.14159265*r);}
  case 2u:{return 0.2+0.8*sin(1.5707963*r);}
  case 3u:{return 1.0;}
  case 4u:{return 0.5+0.5*r;}
  case 5u:{return select((1.0-r)/0.3,r/0.7,r<=0.7);}
  case 6u:{return 1.0-0.8*r;}
  default:{return 0.3+0.7*pow(max(1.0-r,0.0),0.6);}
 }
}
// Crown radius (model units) at height y, for ambient occlusion.
fn sc_crown_radius(p:ScSpecies,y:f32)->f32{let h0=p.base;if y<h0||y>1.02{return 0.02;}let r=1.0-(y-h0)/max(1.0-h0,0.05);return max(0.03,p.width*sc_shape_ratio(p.shape,r));}

// ---- Skeleton: up to 1 + 48 + 192 + 768 branches of orders 0-3 and 2048 leaf cards, rebuilt for the variant being
// generated and read by the vertex pass in the same frame. Unused slots stay dead (zero length, no geometry).
@group(0) @binding(140) var<storage,read_write> sc_skeleton:array<vec4<f32>>;
const SK_BRANCHES:u32=1009u;
const SK_CARDS:u32=2048u;
const SK_CARD_BASE:u32=4036u;
fn sk_first(order:u32)->u32{switch order{case 0u:{return 0u;}case 1u:{return 1u;}case 2u:{return 49u;}default:{return 241u;}}}
fn sk_count(order:u32)->u32{switch order{case 0u:{return 1u;}case 1u:{return 48u;}case 2u:{return 192u;}default:{return 768u;}}}
struct Branch {start:vec3<f32>,r0:f32,dir:vec3<f32>,len:f32,bend:vec3<f32>,r1:f32,parent:u32,order:u32,seed:u32,flags:u32}
// flags: bit 0 alive, bit 1 dead wood, bits 8-15 gnarl, bits 16-23 phase of the limb it belongs to.
fn sk_read(i:u32)->Branch{let a=sc_skeleton[i*4u];let b=sc_skeleton[i*4u+1u];let c=sc_skeleton[i*4u+2u];let d=bitcast<vec4<u32>>(sc_skeleton[i*4u+3u]);return Branch(a.xyz,a.w,b.xyz,b.w,c.xyz,c.w,d.x,d.y,d.z,d.w);}
fn sk_write(i:u32,b:Branch){sc_skeleton[i*4u]=vec4<f32>(b.start,b.r0);sc_skeleton[i*4u+1u]=vec4<f32>(b.dir,b.len);sc_skeleton[i*4u+2u]=vec4<f32>(b.bend,b.r1);sc_skeleton[i*4u+3u]=bitcast<vec4<f32>>(vec4<u32>(b.parent,b.order,b.seed,b.flags));}
fn sk_dead()->Branch{return Branch(vec3<f32>(0),0.0,vec3<f32>(0,1,0),0.0,vec3<f32>(0),0.0,0u,0u,0u,0u);}
fn br_alive(b:Branch)->bool{return (b.flags&1u)!=0u&&b.len>1e-5;}
fn br_axis_ref(b:Branch)->vec3<f32>{
 var a=cross(b.dir,b.bend);if length(a)<1e-5*max(b.len,1e-3){a=cross(b.dir,vec3<f32>(0.0,1.0,0.0));}if length(a)<1e-6{a=cross(b.dir,vec3<f32>(1.0,0.0,0.0));}return normalize(a);
}
fn br_point(b:Branch,t:f32)->vec3<f32>{
 var p=b.start+b.dir*(b.len*t)+b.bend*(t*t);
 let g=f32((b.flags>>8u)&255u)/255.0*0.6;
 if g>0.0{let a=br_axis_ref(b);let c=normalize(cross(b.dir,a));let s=f32(b.seed&1023u)*0.0061;let w=sin(3.14159265*t)*b.len*g;
  p+=(a*(sin(t*7.3+s)*0.6+sin(t*15.1+s*2.3)*0.3)+c*(sin(t*6.1+s*1.7)*0.6+sin(t*13.7+s*0.7)*0.3))*w;}
 return p;
}
fn br_tangent(b:Branch,t:f32)->vec3<f32>{let d=br_point(b,min(t+0.01,1.0))-br_point(b,max(t-0.01,0.0));let l=length(d);if l<1e-8{return b.dir;}return d/l;}
fn br_radius(b:Branch,t:f32)->f32{
 var r=mix(b.r0,b.r1,pow(t,0.85));
 // Root flare at the foot of a trunk.
 if b.order==0u{r*=1.0+0.55*exp(-t*28.0);}
 return r;
}
// Rotate v about unit axis k by angle a.
fn sc_rotate(v:vec3<f32>,k:vec3<f32>,a:f32)->vec3<f32>{let c=cos(a);let s=sin(a);return v*c+cross(k,v)*s+k*dot(k,v)*(1.0-c);}
fn sc_perp(v:vec3<f32>)->vec3<f32>{let a=select(vec3<f32>(0,1,0),vec3<f32>(1,0,0),abs(v.y)>0.9);return normalize(cross(v,a));}
var<workgroup> wg_weight:array<f32,1024>;
var<workgroup> wg_slots:array<u32,1024>;
var<workgroup> wg_total:f32;
fn sc_hashf(s:u32)->f32{return sc_random(s);}
// Spread `budget` child slots over the alive branches of `order` by weight (written to wg_weight by the caller).
// Returns nothing; wg_slots[i] becomes the first slot of branch i and wg_slots[n] the end. Thread 0 only.
fn sk_distribute(first:u32,n:u32,budget:u32){
 var total=0.0;for(var i=0u;i<n;i++){total+=wg_weight[i];}
 var acc=0.0;var given=0u;
 for(var i=0u;i<n;i++){wg_slots[i]=given;acc+=wg_weight[i];let want=select(0u,u32(floor(acc/max(total,1e-9)*f32(budget)+0.5)),total>0.0);given=min(max(want,given),budget);}
 wg_slots[n]=given;wg_total=total;
}
@compute @workgroup_size(64)
fn scenery_tree_skeleton(@builtin(local_invocation_index) lid:u32){
 let v=sc_state.job_index;let ages=sc_tree_ages();let species=v/ages;let age=v%ages;let sp=sc_species(species,age);
 let vseed=hash(v*7919u+bitcast<u32>(f.geo.z)*31u+0x7172u);
 // Order 0: the trunk (or a log's length, a shrub's root stub).
 if lid==0u{
  var t=sk_dead();t.flags=1u|(u32(clamp(sp.gnarl*0.5,0.0,0.5)/0.6*255.0)<<8u);t.order=0u;t.seed=vseed;t.parent=0u;
  let lean_a=sc_hashf(vseed+1u)*6.2831853;let lean=vec3<f32>(cos(lean_a),0.0,sin(lean_a))*sp.lean;
  if sp.kind==5u{t.start=vec3<f32>(-0.5,sp.radius*0.9,0.0);t.dir=vec3<f32>(1,0,0);t.len=1.0;t.bend=vec3<f32>(0.0,0.0,0.03*(sc_hashf(vseed+2u)-0.5));t.r0=sp.radius;t.r1=sp.radius*0.55;}
  else if sp.kind==3u{t.start=vec3<f32>(0);t.dir=vec3<f32>(0,1,0);t.len=0.04;t.r0=sp.radius*1.2;t.r1=sp.radius;}
  else{
   let len=select(sp.trunk,1.0,sp.kind==0u||sp.kind==2u);let top=select(0.015,0.55,sp.kind==1u||sp.kind==4u);
   t.start=vec3<f32>(0.0,-0.02,0.0);t.dir=normalize(vec3<f32>(0,1,0)+lean*0.5);t.len=len*select(1.0,0.98,sp.kind==2u);
   // A palm curves as it rises; other trunks lean a little more near the top.
   t.bend=lean*len*select(0.4,1.2,sp.kind==2u);t.r0=sp.radius;t.r1=sp.radius*select(top,0.75,sp.kind==2u);
  }
  sk_write(0u,t);
  for(var i=1u;i<SK_BRANCHES;i++){sk_write(i,sk_dead());}
 }
 storageBarrier();workgroupBarrier();
 let trunk=sk_read(0u);
 // Order 1: limbs (palm fronds, shrub stems, a log's broken stubs) on the trunk.
 var n1=u32(clamp(round(sp.limbs*(0.92+0.16*sc_hashf(vseed+3u))),0.0,48.0));
 for(var i=lid;i<48u;i+=64u){
  if i>=n1{continue;}
  let h=hash(vseed^(i*0x9e3779b1u));var b=sk_dead();b.order=1u;b.parent=0u;b.seed=h;
  var t=0.0;var phi=0.0;
  if sp.whorl>0.5{let per=u32(sp.whorl);let whorls=max(1u,(n1+per-1u)/per);let w=i/per;let k=i%per;t=sp.base+(1.0-sp.base)*(f32(w)+0.4+0.2*sc_hashf(h))/f32(whorls)*0.97;phi=f32(k)/f32(per)*6.2831853+f32(w)*1.1+0.35*(sc_hashf(h+1u)-0.5);}
  else{let span=select(1.0,sp.trunk,sp.kind==1u||sp.kind==4u);let lo=select(sp.base,0.0,sp.kind==3u);t=lo+(span-lo)*pow((f32(i)+0.3+0.4*sc_hashf(h))/f32(n1),select(0.9,0.6,sp.kind==1u));phi=f32(i)*2.3999632+0.5*(sc_hashf(h+1u)-0.5);}
  if sp.kind==2u{t=0.97+0.03*sc_hashf(h);}
  if sp.kind==5u{t=0.1+0.8*sc_hashf(h);}
  t=clamp(t,0.0,0.995);
  let at=br_point(trunk,t);let tan=br_tangent(trunk,t);let nx=normalize(cross(tan,vec3<f32>(0,0,1))+vec3<f32>(1e-4,0,0));let nz=cross(nx,tan);
  let out=nx*cos(phi)+nz*sin(phi);
  let rel=clamp((t*select(1.0,trunk.len,sp.kind!=5u)-sp.base)/max(1.0-sp.base,0.05),0.0,1.0);
  var angle=mix(sp.angle0,sp.angle1,rel)+0.18*(sc_hashf(h+2u)-0.5);
  // Leaders of a decurrent crown: the last limbs carry on from the fork almost upward.
  let leader=(sp.kind==1u)&&i+3u>=n1;
  if leader{angle=0.25+0.35*sc_hashf(h+3u);}
  var dir=normalize(tan*cos(angle)+out*sin(angle));
  let r=1.0-rel;var len=sp.width*sc_shape_ratio(sp.shape,r)/max(sin(angle),0.35)*(0.82+0.36*sc_hashf(h+4u));
  if leader{len=max(len,(1.0-t*trunk.len)*0.85);}
  if sp.kind==2u{len=sp.width*(0.8+0.4*sc_hashf(h+4u));angle=mix(0.25,1.45,f32(i)/f32(max(n1,1u)));dir=normalize(tan*cos(angle)+out*sin(angle));}
  if sp.kind==3u{len=0.6+0.4*sc_hashf(h+4u);dir=normalize(vec3<f32>(0,1,0)*cos(angle)+out*sin(angle));}
  if sp.kind==5u{len=0.03+0.05*sc_hashf(h+4u);dir=normalize(vec3<f32>(0,1,0)*0.6+out);}
  var dead=sc_hashf(h+5u)<sp.dead*select(0.4,1.0,rel<0.25)||sp.kind>=4u;
  // A conifer drops its shaded lower limbs: short dead stubs below the living crown.
  if sp.kind==0u&&sp.whorl>0.5&&rel<0.08&&sc_hashf(h+6u)<0.5{dead=true;len*=0.35;}
  if dead&&sp.kind<4u{len*=0.55;}
  if sp.kind==4u{len*=0.45+0.3*sc_hashf(h+7u);}
  let up=vec3<f32>(0,1,0);
  b.start=at;b.dir=dir;b.len=len;
  // Tropisms: rise toward the light, sag under weight that grows with length, and for a palm frond a full arch.
  b.bend=up*len*(sp.rise*(1.0-rel*0.5))-up*len*len/max(sp.width,0.05)*sp.droop+out*len*0.08;
  if sp.kind==2u{b.bend=-up*len*sp.droop*(0.6+0.5*f32(i)/f32(max(n1,1u)))+out*len*0.15;}
  let parent_r=br_radius(trunk,t);
  b.r0=min(parent_r*select(0.62,0.38,sp.kind==0u),max(0.002,sp.radius*select(0.55,0.32,sp.kind==0u)*sqrt(len/max(sp.width,0.05))));
  if sp.kind==2u{b.r0=sp.radius*0.18;}
  if sp.kind==3u{b.r0=sp.radius;}
  b.r1=b.r0*select(0.18,0.35,dead);
  b.flags=1u|select(0u,2u,dead)|(u32(clamp(sp.gnarl,0.0,0.6)/0.6*255.0)<<8u)|((h>>8u)&255u)<<16u;
  sk_write(1u+i,b);
 }
 storageBarrier();workgroupBarrier();
 // Orders 2 and 3: branches along limbs and twigs along branches, a fixed budget spread over the living parents by length.
 for(var order=2u;order<=3u;order++){
  let pf=sk_first(order-1u);let pn=sk_count(order-1u);let budget=sk_count(order);
  for(var i=lid;i<pn;i+=64u){let p=sk_read(pf+i);var w=0.0;if br_alive(p)&&(p.flags&2u)==0u&&sp.kind!=2u&&sp.kind<4u{w=p.len*select(1.0,0.5,order==3u&&sp.leaf==LF_BUNDLE);}if (p.flags&2u)!=0u&&sp.kind>=4u&&order==2u{w=p.len*0.3;}wg_weight[i]=w;}
  workgroupBarrier();
  if lid==0u{sk_distribute(pf,pn,budget);}
  workgroupBarrier();
  for(var j=lid;j<budget;j+=64u){
   if j>=wg_slots[pn]{continue;}
   // Parent: the branch whose slot range holds j (binary search over the prefix).
   var lo=0u;var hi=pn;
   loop{if hi-lo<=1u{break;}let mid=(lo+hi)/2u;if wg_slots[mid]<=j{lo=mid;}else{hi=mid;}}
   let pi=lo;let p=sk_read(pf+pi);let k=j-wg_slots[pi];let n=max(1u,wg_slots[pi+1u]-wg_slots[pi]);
   let h=hash(vseed^((order*4096u+j)*0x85ebca6bu));
   var b=sk_dead();b.order=order;b.parent=pf+pi;b.seed=h;
   let t=clamp(select(0.18,0.25,order==3u)+(1.0-select(0.18,0.25,order==3u))*(f32(k)+0.25+0.5*sc_hashf(h))/f32(n),0.0,0.99);
   let at=br_point(p,t);let tan=br_tangent(p,t);let up=vec3<f32>(0,1,0);
   // Alternate sides in the plane facing the light: left, right, with a little spiral.
   var side=cross(tan,up);if length(side)<0.05{side=sc_perp(tan);}side=normalize(side);
   let flip=select(-1.0,1.0,((k+(h&1u))&1u)==0u);
   let spiral=0.6*(sc_hashf(h+1u)-0.5)+select(0.0,1.2*(sc_hashf(h+2u)-0.5),sp.kind==1u);
   let out=sc_rotate(side*flip,tan,spiral);
   let a=sp.b_angle*(0.8+0.4*sc_hashf(h+3u));
   var dir=normalize(tan*cos(a)+out*sin(a));
   // Phototropism: young shoots turn up; conifer sprays stay level.
   let pl=p.len;
   var len=select(sp.t_len,sp.b_len,order==2u)*pl*(1.0-0.55*t)*(0.75+0.5*sc_hashf(h+4u));
   let droop=select(sp.b_droop*0.6,sp.b_droop,order==2u);
   b.start=at;b.dir=dir;b.len=len;
   b.bend=up*len*(select(0.15,0.25,order==2u)*sp.rise)-up*len*droop*select(0.6,1.0,order==2u)*(0.6+0.8*t);
   // Weeping forms: whips that fall toward the ground.
   if droop>1.0&&order==2u{b.len=len*1.6;b.bend=-up*b.len*0.9*droop*0.6+dir*0.0;}
   let parent_r=br_radius(p,t);
   b.r0=min(parent_r*0.7,max(0.0012,parent_r*sqrt(len/max(pl,1e-4))*0.75));b.r1=b.r0*0.25;
   let dead=(p.flags&2u)!=0u;
   b.flags=1u|select(0u,2u,dead)|(u32(clamp(sp.gnarl*0.7,0.0,0.6)/0.6*255.0)<<8u)|(p.flags&0xff0000u);
   sk_write(sk_first(order)+j,b);
  }
  storageBarrier();workgroupBarrier();
 }
 // Leaf cards along the branches that carry them, at most SK_CARDS. Each card holds a twig with its leaves or needles.
 let carriers_first=0u;let carriers=SK_BRANCHES;
 for(var i=lid;i<carriers;i+=64u){let b=sk_read(carriers_first+i);var w=0.0;
  // Needle sprays lie along limbs and branches; broad leaves on twigs, with some on the outer part of branches.
  let needles=sp.leaf==LF_SPRAY||sp.leaf==LF_TUFT||sp.leaf==LF_BUNDLE;
  if br_alive(b)&&(b.flags&2u)==0u&&sp.card>0.0&&b.order>=sp.card_order{w=b.len*select(select(1.0,0.35,b.order<3u&&sp.card_order==3u),select(1.0,0.3,b.order==3u),needles);}
  // Broadleaf crowns also leaf out along the outer part of their branches; a palm frond carries the whole frond.
  if br_alive(b)&&(b.flags&2u)==0u&&sp.card>0.0&&sp.card_order==3u&&b.order==2u{w=b.len*0.35;}
  if br_alive(b)&&sp.kind==2u&&b.order==1u{w=b.len;}
  // An excurrent conifer's leader carries sprays near its top.
  if br_alive(b)&&b.order==0u{w=select(0.0,b.len*0.35,sp.kind==0u&&sp.card_order<=2u&&sp.card>0.0);}
  wg_weight[i]=w;}
 workgroupBarrier();
 if lid==0u{sk_distribute(carriers_first,carriers,SK_CARDS);}
 workgroupBarrier();
 for(var j=lid;j<SK_CARDS;j+=64u){
  let base=SK_CARD_BASE+j*3u;
  if j>=wg_slots[carriers]{sc_skeleton[base]=vec4<f32>(0);sc_skeleton[base+1u]=vec4<f32>(0,1,0,0);sc_skeleton[base+2u]=vec4<f32>(0,0,1,0);continue;}
  var lo=0u;var hi=carriers;
  loop{if hi-lo<=1u{break;}let mid=(lo+hi)/2u;if wg_slots[mid]<=j{lo=mid;}else{hi=mid;}}
  let b=sk_read(carriers_first+lo);let k=j-wg_slots[lo];let n=max(1u,wg_slots[lo+1u]-wg_slots[lo]);
  let h=hash(vseed^(j*0xc2b2ae35u+0x51u));
  var tmin=select(select(0.3,0.08,sp.card_order<=2u),0.12,sp.kind==2u);if b.order==0u{tmin=0.8;}if b.order==1u&&sp.kind!=2u{tmin=0.25;}
  let t=clamp(tmin+(1.0-tmin)*(f32(k)+0.2+0.6*sc_hashf(h))/f32(n),0.0,1.0);
  let at=br_point(b,t);let tan=br_tangent(b,t);let up=vec3<f32>(0,1,0);
  var cu=tan;var cn=vec3<f32>(0,1,0);
  let size=sp.card*(0.72+0.5*sc_hashf(h+1u))/max(sp.height*(0.55+0.45*min(sc_age_value(age),1.0))*(1.0+0.15*max(sc_age_value(age)-1.0,0.0)),1.0);
  if sp.leaf==LF_SPRAY||sp.leaf==LF_TUFT{
   // Conifer sprays lie nearly flat along their twig.
   cu=normalize(tan+up*0.15*(sc_hashf(h+2u)-0.3));var s=cross(cu,up);if length(s)<0.05{s=sc_perp(cu);}cn=normalize(cross(normalize(s),cu));if cn.y<0.0{cn=-cn;}
   cn=sc_rotate(cn,cu,0.5*(sc_hashf(h+3u)-0.5));
  }else if sp.kind==2u{
   // A palm frond's leaflets spread to both sides of the rachis.
   cu=tan;var s=cross(cu,up);if length(s)<0.05{s=sc_perp(cu);}cn=normalize(cross(normalize(s),cu));if cn.y<0.0{cn=-cn;}cn=sc_rotate(cn,cu,0.35*(sc_hashf(h+3u)-0.5));
  }else if sp.b_droop>1.0{
   // Weeping: the leaves hang along the whip.
   cu=normalize(tan*0.6-up*0.8+sc_perp(tan)*0.2*(sc_hashf(h+2u)-0.5));let s=sc_perp(cu);cn=sc_rotate(s,cu,sc_hashf(h+3u)*6.2831853);
  }else{
   // Twigs angle away from their branch toward the light; the leaves face up and out.
   let out=normalize(sc_rotate(sc_perp(tan),tan,sc_hashf(h+2u)*6.2831853));
   cu=normalize(tan+out*0.7+up*0.25);
   let face=normalize(up*0.8+vec3<f32>(at.x,0.0,at.z)*0.6+out*0.2);
   cn=normalize(face-cu*dot(face,cu));
   cn=sc_rotate(cn,cu,1.0*(sc_hashf(h+3u)-0.5));
  }
  // Ambient occlusion from depth in the crown: inner and lower cards darker.
  let rel=length(at.xz)/max(sc_crown_radius(sp,at.y),0.04);
  let ao=clamp(mix(0.42,1.0,smoothstep(0.15,1.0,rel))*mix(0.78,1.0,clamp((at.y-sp.base)/max(1.0-sp.base,0.1),0.0,1.0)),0.3,1.0);
  sc_skeleton[base]=vec4<f32>(at,size);
  sc_skeleton[base+1u]=vec4<f32>(cu,f32((h>>4u)&3u));
  sc_skeleton[base+2u]=vec4<f32>(cn,min(ao,0.996)+f32((b.flags>>16u)&255u));
 }
}
fn sc_bounds_add(v:u32,p:vec3<f32>,center:vec3<f32>){atomicMax(&sc_state.bounds[v],bitcast<u32>(length(p-center)+0.02));}
fn sc_geometry_store(index:u32,v:ScV){let w=sc_pack(v);for(var k=0u;k<8u;k++){sc_geometry[index*SC_WORDS+k]=w[k];}}
// One vertex of the tree variant in classes 0-2.
@compute @workgroup_size(64)
fn scenery_tree_vertices(@builtin(global_invocation_id) id:vec3<u32>){
 let v=sc_state.job_index;let total=sc_class_verts(0u)+sc_class_verts(1u)+sc_class_verts(2u);if id.x>=total{return;}
 var c=0u;var lv=id.x;if lv>=sc_class_verts(0u){lv-=sc_class_verts(0u);c=1u;if lv>=sc_class_verts(1u){lv-=sc_class_verts(1u);c=2u;}}
 let l=sc_locate(c,lv);let ages=sc_tree_ages();let sp=sc_species(v/ages,v%ages);
 var out=ScV(vec3<f32>(0),vec3<f32>(0,1,0),vec3<f32>(1,0,0),vec2<f32>(0),SM_NONE,0u,1.0,0.0,0u,0.0,0.0,0.0,0.0);
 let tubes=select(select(3u,2u,c==2u),4u,c==0u);
 if l.g<tubes{
  let bi=sk_first(l.g)+l.p;let b=sk_read(bi);
  if br_alive(b){
   let t=f32(l.j)/f32(l.rows);let theta=f32(l.i)/f32(l.cols)*6.2831853;
   let cpos=br_point(b,t);let tan=br_tangent(b,t);let a=br_axis_ref(b);let nrm=normalize(a-tan*dot(a,tan));let bin=cross(tan,nrm);
   let r=br_radius(b,t);let radial=nrm*cos(theta)+bin*sin(theta);
   let slope=(br_radius(b,max(t-0.02,0.0))-br_radius(b,min(t+0.02,1.0)))/max(0.04*b.len,1e-6);
   out.p=cpos+radial*r;out.n=normalize(radial+tan*slope);out.t=tan;
   out.uv=vec2<f32>(f32(l.i)/f32(l.cols),clamp(t*b.len*0.5,0.0,1.0));
   out.material=select(SM_BARK,SM_DEAD,(b.flags&2u)!=0u||sp.kind>=4u);out.order=b.order;
   out.radius=r;out.extra=f32(b.order);out.phase=f32((b.flags>>16u)&255u)/255.0;
   let rel=length(cpos.xz)/max(sc_crown_radius(sp,cpos.y),0.04);
   out.ao=clamp(select(mix(0.55,1.0,smoothstep(0.1,1.0,rel)),mix(0.6,1.0,smoothstep(0.0,0.5,cpos.y)),b.order==0u),0.3,1.0);
   // Wind: a limb bends about its base, more toward its tip and the longer it is; the trunk sways as a whole (vertex stage).
   out.bend=select(pow(t,1.5)*min(b.len,0.6)*select(0.6,1.0,b.order>=2u),0.0,b.order==0u);
   if b.order>=2u{let p=sk_read(b.parent);out.bend+=0.5*min(p.len,0.6);}
   out.aux=v/ages;
  }
 }else{
  // A leaf card. Coarser levels keep every 4th or 16th card, larger by the area they stand for.
  let stride=select(select(16u,4u,c==1u),1u,c==0u);let grow=select(select(3.4,1.75,c==1u),1.0,c==0u);
  let ci=l.p*stride+(hash(l.p*977u+v)%stride);let base=SK_CARD_BASE+ci*3u;
  let a=sc_skeleton[base];let u=sc_skeleton[base+1u];let nn=sc_skeleton[base+2u];
  if a.w>0.0{
   let size=a.w*grow;let cu=u.xyz;let cn=nn.xyz;let side=normalize(cross(cu,cn));
   let q=vec2<f32>(f32(l.i),f32(l.j));
   out.p=a.xyz+side*(q.x-0.5)*size+cu*(q.y-0.12)*size;
   // Normals bent toward the outside of the crown soften a crown of flat cards into a volume.
   let outward=normalize(vec3<f32>(out.p.x,(out.p.y-mix(sp.base,1.0,0.55))*0.6,out.p.z)+cn*0.3);
   out.n=normalize(cn*0.55+outward*0.45);out.t=cu;
   let quad=u32(u.w);out.uv=q;
   out.material=SM_LEAF;out.order=3u;out.ao=fract(nn.w)*0.999;out.phase=floor(nn.w)/255.0;
   out.bend=0.55+0.25*q.y;out.flutter=0.4+0.6*q.y;out.radius=size;out.aux=(v/ages)|(quad<<4u);
  }
 }
 sc_geometry_store(sc_state.class_base[c]+v*sc_class_verts(c)+lv,out);
 if out.material!=SM_NONE{sc_bounds_add(v,out.p,vec3<f32>(0,0.5,0));}
}

// ---- Rocks: six geological families on cube-sphere grids, each with four seeded variants.
// 0 fractured block (plane cuts), 1 bedded slab (strata ledges), 2 river cobble, 3 exfoliated granite boulder,
// 4 talus/scree fragment, 5 regolith block (airless bodies).
fn sc_vhash3(c:vec3<i32>,seed:u32)->f32{return f32(hash(bitcast<u32>(c.x)^hash(bitcast<u32>(c.y)^hash(bitcast<u32>(c.z)^seed)))>>8u)*(2.0/16777215.0)-1.0;}
fn sc_vnoise(p:vec3<f32>,seed:u32)->f32{
 let i=vec3<i32>(floor(p));let t=p-floor(p);let w=t*t*(3.0-2.0*t);
 let a=mix(mix(sc_vhash3(i,seed),sc_vhash3(i+vec3<i32>(1,0,0),seed),w.x),mix(sc_vhash3(i+vec3<i32>(0,1,0),seed),sc_vhash3(i+vec3<i32>(1,1,0),seed),w.x),w.y);
 let b=mix(mix(sc_vhash3(i+vec3<i32>(0,0,1),seed),sc_vhash3(i+vec3<i32>(1,0,1),seed),w.x),mix(sc_vhash3(i+vec3<i32>(0,1,1),seed),sc_vhash3(i+vec3<i32>(1,1,1),seed),w.x),w.y);
 return mix(a,b,w.z);
}
fn sc_fbm(p:vec3<f32>,seed:u32,octaves:u32)->f32{var s=0.0;var a=0.5;var q=p;for(var k=0u;k<octaves;k++){s+=a*sc_vnoise(q,seed+k*101u);q=q*2.03+vec3<f32>(17.1,3.7,9.2);a*=0.5;}return s;}
fn sc_rock_family(r:u32)->u32{return min(r/4u,5u);}
fn sc_rock_axes(family:u32,seed:u32)->vec3<f32>{
 let j=vec3<f32>(sc_random(seed+11u),sc_random(seed+12u),sc_random(seed+13u))-0.5;
 switch family{
  case 0u:{return vec3<f32>(1.0,0.72,0.86)+j*vec3<f32>(0.1,0.25,0.2);}
  case 1u:{return vec3<f32>(1.15,0.42,0.95)+j*vec3<f32>(0.1,0.15,0.2);}
  case 2u:{return vec3<f32>(1.0,0.56,0.76)+j*vec3<f32>(0.0,0.2,0.2);}
  case 3u:{return vec3<f32>(1.0,0.82,0.9)+j*vec3<f32>(0.1,0.2,0.15);}
  case 4u:{return vec3<f32>(1.0,0.38,0.7)+j*vec3<f32>(0.1,0.15,0.25);}
  default:{return vec3<f32>(1.0,0.7,0.85)+j*vec3<f32>(0.1,0.25,0.2);}
 }
}
fn sc_rock_radius(d:vec3<f32>,family:u32,seed:u32)->f32{
 let pw=select(select(select(select(select(4.0,6.0,family==4u),2.4,family==3u),2.0,family==2u),3.5,family==1u),5.0,family==0u);
 // Superellipsoid radius toward d.
 var r=pow(pow(abs(d.x),pw)+pow(abs(d.y),pw)+pow(abs(d.z),pw),-1.0/pw);
 r*=1.0+select(0.09,0.05,family==2u)*sc_fbm(d*1.6,seed,2u);
 if family==0u||family==4u||family==5u{
  let cuts=select(select(5u,7u,family==0u),5u,family==4u);
  for(var k=0u;k<cuts;k++){
   let a=sc_random(seed+k*3u)*6.2831853;let e=(sc_random(seed+k*3u+1u)-0.35)*1.3;let n=normalize(vec3<f32>(cos(a)*cos(e),sin(e),sin(a)*cos(e)));
   let o=select(0.6,0.5,family==4u)+0.25*sc_random(seed+k*3u+2u);let c=dot(d,n);if c>0.05{r=min(r,o/c);}
  }
  r-=select(0.025,0.04,family==5u)*abs(sc_fbm(d*9.0,seed+77u,2u));
 }
 if family==3u{
  // Exfoliation sheets on the upper half and two crack grooves.
  let shell=smoothstep(0.55,0.8,fract(r*5.5+0.4*sc_vnoise(d*2.0,seed+5u)))*smoothstep(-0.2,0.3,d.y);r-=0.035*shell;
  for(var k=0u;k<2u;k++){let a=sc_random(seed+40u+k)*6.2831853;let n=normalize(vec3<f32>(cos(a),0.3*(sc_random(seed+42u+k)-0.5),sin(a)));let g=dot(d,n)+0.06*sc_vnoise(d*3.0,seed+44u+k);r-=0.045*exp(-g*g/0.0009);}
 }
 return r;
}
fn sc_rock_point(face:u32,uv:vec2<f32>,family:u32,seed:u32)->vec3<f32>{
 let q=uv*2.0-1.0;var c=vec3<f32>(0);
 switch face{case 0u:{c=vec3<f32>(1.0,q.y,-q.x);}case 1u:{c=vec3<f32>(-1.0,q.y,q.x);}case 2u:{c=vec3<f32>(q.x,1.0,-q.y);}case 3u:{c=vec3<f32>(q.x,-1.0,q.y);}case 4u:{c=vec3<f32>(q.x,q.y,1.0);}default:{c=vec3<f32>(-q.x,q.y,-1.0);}}
 let d=normalize(c);var p=d*sc_rock_radius(d,family,seed)*sc_rock_axes(family,seed);
 if family==1u{
  // Bedding: every other layer set back, along a dipping plane, so the strata read as ledges.
  let dip=normalize(vec3<f32>(0.25*(sc_random(seed+20u)-0.5),1.0,0.25*(sc_random(seed+21u)-0.5)));
  let s=dot(p,dip)*6.0+0.35*sc_vnoise(p*2.0,seed+22u);let inset=0.07*smoothstep(0.6,0.85,fract(s))*(1.0-smoothstep(0.92,1.0,fract(s)));p=p-normalize(p-dip*dot(p,dip)+vec3<f32>(1e-5))*inset;
 }
 return p;
}
@compute @workgroup_size(64)
fn scenery_rock_vertices(@builtin(global_invocation_id) id:vec3<u32>){
 let v=sc_state.job_index;let r=v-sc_tree_variants();if r>=SC_ROCK_VARIANTS{return;}
 let total=sc_class_verts(3u)+sc_class_verts(4u);if id.x>=total{return;}
 var c=3u;var lv=id.x;if lv>=sc_class_verts(3u){lv-=sc_class_verts(3u);c=4u;}
 let l=sc_locate(c,lv);let family=sc_rock_family(r);let seed=hash(r*2654435761u+bitcast<u32>(f.geo.z)+0x524fu);
 let uv=vec2<f32>(f32(l.i),f32(l.j))/f32(l.cols);let face=l.p;
 let p=sc_rock_point(face,uv,family,seed);let e=0.5/f32(l.cols*4u);
 let da=sc_rock_point(face,uv+vec2<f32>(e,0),family,seed)-sc_rock_point(face,uv-vec2<f32>(e,0),family,seed);
 let db=sc_rock_point(face,uv+vec2<f32>(0,e),family,seed)-sc_rock_point(face,uv-vec2<f32>(0,e),family,seed);
 var n=cross(da,db);if dot(n,p)<0.0{n=-n;}
 var out=ScV(p,normalize(n+vec3<f32>(0,1e-7,0)),normalize(da),uv,SM_ROCK,0u,clamp(mix(0.5,1.0,smoothstep(-0.7,0.25,p.y)),0.3,1.0),0.0,family,0.0,0.0,0.0,0.0);
 sc_geometry_store(sc_state.class_base[c]+r*sc_class_verts(c)+lv,out);
 sc_bounds_add(v,p,vec3<f32>(0));
 // The lowest point of the rock over an 8 x 8 grid of its footprint (model x, z in -1.4..1.4): what support compares
 // with the ground at each of those cells.
 if c==3u{let cell=vec2<u32>(clamp((p.xz+1.4)/2.8*8.0,vec2<f32>(0.0),vec2<f32>(7.0)));atomicMin(&sc_state.bottom[r*64u+cell.y*8u+cell.x],sc_order_float(p.y));}
}
fn sc_order_float(x:f32)->u32{let b=bitcast<u32>(x);return select(b^0x80000000u,~b,(b&0x80000000u)!=0u);}
fn sc_unorder_float(u:u32)->f32{return bitcast<f32>(select(~u,u^0x80000000u,(u&0x80000000u)!=0u));}

// ---- Ground cover meshes, built once: grass clumps (8, with flowers on half), reed clumps (4), pebble clusters (8),
// ferns (4), understorey bushes (4). Units are metres; the instance scales them about 0.7-1.4.
@compute @workgroup_size(64)
fn scenery_cover_vertices(@builtin(global_invocation_id) id:vec3<u32>){
 var i=id.x;var c=5u;
 loop{if c>9u{return;}let n=sc_class_verts(c)*sc_class_variants(c);if i<n{break;}i-=n;c++;}
 let variant=i/sc_class_verts(c);let lv=i%sc_class_verts(c);let l=sc_locate(c,lv);
 let seed=hash(c*7741u+variant*131u+0x6772u);let hs=hash(seed+l.p*977u);
 var out=ScV(vec3<f32>(0),vec3<f32>(0,1,0),vec3<f32>(0,1,0),vec2<f32>(0),SM_NONE,0u,1.0,sc_random(hs+9u),variant,0.0,0.0,0.0,0.0);
 let s=f32(l.j)/f32(l.rows);let side=f32(l.i)-0.5;
 switch c{
  case 5u:{
   if l.g==0u{
    // A grass blade: a curved strip from the clump's centre, narrowing to its tip.
    let a=sc_random(hs)*6.2831853;let base=vec3<f32>(cos(a),0.0,sin(a))*0.22*sqrt(sc_random(hs+1u));let h=0.3+0.5*sc_random(hs+2u);
    let lean=vec3<f32>(cos(a+0.6*(sc_random(hs+3u)-0.5)),0.0,sin(a+0.6*(sc_random(hs+3u)-0.5)));let curl=0.25+0.35*sc_random(hs+4u);
    let pt=base+vec3<f32>(0,h*s*(1.0-0.25*s*curl),0)+lean*h*curl*s*s;let tan=normalize(vec3<f32>(0,h*(1.0-0.5*s*curl),0)+lean*h*curl*2.0*s);
    let across=normalize(cross(tan,lean)+vec3<f32>(1e-5,0,0));let w=0.016*(1.0-pow(s,1.6))+0.002;
    out.p=pt+across*side*w;out.n=normalize(cross(across,tan)*0.6+vec3<f32>(0,0.8,0));out.t=tan;out.uv=vec2<f32>(f32(l.i),s);
    out.material=SM_GRASS;out.bend=s*s*h;out.flutter=s;out.ao=mix(0.45,1.0,s);out.radius=w;out.extra=h;
   }else if variant>=4u{
    // A few flowers on half the clumps: small heads at the tips of three blades.
    let a=sc_random(hash(seed+l.p*4u*977u))*6.2831853;let tip=vec3<f32>(cos(a)*0.2,0.42+0.25*sc_random(seed+l.p),sin(a)*0.2);
    let q=vec2<f32>(f32(l.i),f32(l.j))-0.5;let size=0.022+0.01*sc_random(seed+l.p+5u);
    out.p=tip+vec3<f32>(q.x,0.0,q.y)*size*2.0+vec3<f32>(0,0.002,0);out.n=vec3<f32>(0,1,0);out.t=vec3<f32>(1,0,0);out.uv=q+0.5;
    out.material=SM_FLOWER;out.aux=variant|((seed>>3u)%3u)<<4u;out.bend=0.3;out.flutter=1.0;out.ao=1.0;
   }
  }
  case 6u:{
   if l.g==0u{
    let a=sc_random(hs)*6.2831853;let base=vec3<f32>(cos(a),0.0,sin(a))*0.22*sqrt(sc_random(hs+1u));let h=1.1+0.9*sc_random(hs+2u);
    let lean=vec3<f32>(cos(a),0.0,sin(a))*0.08;let pt=base+vec3<f32>(0,h*s,0)+lean*h*s*s;let tan=normalize(vec3<f32>(0,h,0)+lean*h*2.0*s);
    let across=normalize(cross(tan,vec3<f32>(cos(a+1.3),0.0,sin(a+1.3))));let w=0.007*(1.0-0.7*s)+0.001;
    out.p=pt+across*side*w;out.n=normalize(cross(across,tan)*0.5+vec3<f32>(0,0.6,0));out.t=tan;out.uv=vec2<f32>(f32(l.i),s);
    out.material=SM_REED;out.bend=s*s*h;out.flutter=0.3*s;out.ao=mix(0.5,1.0,s);out.radius=w;out.extra=h;
   }else{
    // Cattail heads on four stalks.
    let k=l.p;let hk=hash(seed+k*977u);let a=sc_random(hk)*6.2831853;let base=vec3<f32>(cos(a),0.0,sin(a))*0.22*sqrt(sc_random(hk+1u));let h=1.1+0.9*sc_random(hk+2u);
    let y=h*(0.72+0.12*s);let across=normalize(vec3<f32>(cos(a+1.3),0.0,sin(a+1.3)));
    out.p=base+vec3<f32>(0,y,0)+vec3<f32>(cos(a),0.0,sin(a))*0.08*h*(y/h)*(y/h)+across*side*0.026;out.n=normalize(cross(across,vec3<f32>(0,1,0)));out.t=vec3<f32>(0,1,0);out.uv=vec2<f32>(f32(l.i),s);
    out.material=SM_REED;out.aux=variant|16u;out.bend=y*0.8;out.flutter=0.1;out.ao=1.0;out.radius=0.026;out.extra=h;
   }
  }
  case 7u:{
   // Six pebbles per cluster, 3-14 cm, flattened and lumpy.
   let pebble=l.p/6u;let face=l.p%6u;let hp=hash(seed+pebble*977u);
   let a=sc_random(hp)*6.2831853;let ctr=vec3<f32>(cos(a),0.0,sin(a))*0.45*sqrt(sc_random(hp+1u));
   let size=0.03+0.11*pow(sc_random(hp+2u),1.6);let fam=select(0u,2u,sc_random(hp+3u)<0.7);
   let uv=vec2<f32>(f32(l.i),f32(l.j))/2.0;let q=sc_rock_point(face,uv,fam,hp)*vec3<f32>(1.0,0.75,1.0);
   let yaw=sc_random(hp+4u)*6.2831853;let rq=vec3<f32>(q.x*cos(yaw)-q.z*sin(yaw),q.y,q.x*sin(yaw)+q.z*cos(yaw));
   out.p=ctr+rq*size+vec3<f32>(0,size*0.25,0);out.n=normalize(rq);out.t=vec3<f32>(1,0,0);out.uv=uv;out.material=SM_PEBBLE;out.aux=variant|(pebble<<4u);out.ao=mix(0.55,1.0,smoothstep(-0.6,0.4,q.y));out.radius=size;
  }
  case 8u:{
   // Fern fronds arching out from the centre; their pinnae come from the fern layer of the leaf atlas.
   let a=(f32(l.p)+0.3*sc_random(hs))/7.0*6.2831853;let len=0.5+0.3*sc_random(hs+1u);let out_d=vec3<f32>(cos(a),0.0,sin(a));
   let pt=out_d*len*s*0.9+vec3<f32>(0,len*(0.55*s-0.45*s*s)+0.02,0);let tan=normalize(out_d*0.9+vec3<f32>(0,0.55-0.9*s,0));let across=normalize(cross(vec3<f32>(0,1,0),out_d));
   out.p=pt+across*side*0.2*len*(1.0-0.5*s);out.n=normalize(cross(tan,across)*-1.0+vec3<f32>(0,0.3,0));if out.n.y<0.0{out.n=-out.n;}out.t=tan;out.uv=vec2<f32>(f32(l.i),s);
   out.material=SM_FERN;out.aux=(variant&3u)<<4u;out.bend=s*0.3;out.flutter=s;out.ao=mix(0.55,1.0,s);out.radius=0.2*len;
  }
  default:{
   if l.g==0u{
    let a=f32(l.p)*2.1+sc_random(seed);let d=normalize(vec3<f32>(cos(a)*0.55,1.0,sin(a)*0.55));let th=f32(l.i)/3.0*6.2831853;
    let nrm=sc_perp(d);let bin=cross(d,nrm);let r=0.018*(1.0-0.6*s);let radial=nrm*cos(th)+bin*sin(th);
    out.p=d*0.5*s+radial*r;out.n=radial;out.t=d;out.uv=vec2<f32>(f32(l.i)/3.0,s*0.4);out.material=SM_BARK;out.aux=SC_SHRUB;out.radius=r;out.ao=0.6;out.bend=s*0.3;
   }else{
    let k=l.p;let hk=hash(seed+k*977u);let dir=normalize(vec3<f32>(sc_random(hk)-0.5,0.1+0.8*sc_random(hk+1u),sc_random(hk+2u)-0.5));
    let ctr=vec3<f32>(0,0.4,0)+dir*vec3<f32>(0.55,0.38,0.55)*(0.45+0.55*sc_random(hk+3u));let cu=normalize(dir+vec3<f32>(0,0.4,0));let cn=normalize(dir-cu*dot(dir,cu)+vec3<f32>(0,0.2,0));let sd=normalize(cross(cu,cn));
    let q=vec2<f32>(f32(l.i),f32(l.j));let size=0.5;
    out.p=ctr+sd*(q.x-0.5)*size+cu*(q.y-0.3)*size;out.n=normalize(cn*0.5+dir*0.5);out.t=cu;let quad=(hk>>5u)&3u;out.uv=q;
    out.material=SM_LEAF;out.aux=SC_SHRUB|(quad<<4u);out.ao=mix(0.5,1.0,smoothstep(0.2,1.0,length(ctr-vec3<f32>(0,0.55,0))/0.45));out.bend=0.3;out.flutter=0.5+0.5*q.y;out.radius=size;
   }
  }
 }
 sc_geometry_store(sc_state.class_base[c]+variant*sc_class_verts(c)+lv,out);
}
// The template index buffer, once: six indices per quad of every class.
@group(0) @binding(141) var<storage,read_write> sc_index_write:array<u32>;
@compute @workgroup_size(64)
fn scenery_templates(@builtin(global_invocation_id) id:vec3<u32>){
 var q=id.x;if q>=SC_TEMPLATE_QUADS{return;}var c=0u;
 loop{if c>SC_CLASSES{return;}if q<sc_class_quads(c){break;}q-=sc_class_quads(c);c++;}
 let first=sc_class_first(c)+q*6u;var qbase=0u;var vbase=0u;
 for(var g=0u;g<6u;g++){
  let d=sc_group(c,g);if d.x==0u{break;}let per_q=d.y*d.z;let per_v=(d.y+1u)*(d.z+1u);
  if q<qbase+d.x*per_q{
   let r=q-qbase;let p=r/per_q;let k=r%per_q;let i=k%d.y;let j=k/d.y;let o=vbase+p*per_v;
   let a=o+j*(d.y+1u)+i;let b=a+1u;let cc=a+d.y+1u;let dd=cc+1u;let tag=select(c<<24u,(5u<<24u)|0x800000u,c==10u);
   sc_index_write[first]=tag|a;sc_index_write[first+1u]=tag|b;sc_index_write[first+2u]=tag|dd;
   sc_index_write[first+3u]=tag|a;sc_index_write[first+4u]=tag|dd;sc_index_write[first+5u]=tag|cc;
   return;
  }
  qbase+=d.x*per_q;vbase+=d.x*per_v;
 }
}

// ---- Twig and leaf cards: one layer per species (2 x 2 card variants), drawn analytically from stems and leaves with a
// 2 x 2 supersample. Colour is sqrt-encoded albedo with coverage; the second texture holds the card-space normal (xy),
// translucency (z: thin blade 1, stem 0) and height above the card (w).
@group(0) @binding(142) var sc_leaf_color_out:texture_storage_2d_array<rgba8unorm,write>;
@group(0) @binding(143) var sc_leaf_normal_out:texture_storage_2d_array<rgba8unorm,write>;
struct LeafHit {color:vec3<f32>,alpha:f32,normal:vec3<f32>,thick:f32,height:f32}
fn leaf_layer_type(layer:u32)->u32{if layer==SC_FERN_LAYER{return LF_FERN;}return sc_species_base(layer).leaf;}
fn leaf_layer_color(layer:u32)->vec3<f32>{if layer==SC_FERN_LAYER{return vec3<f32>(0.045,0.095,0.025);}if layer==SC_SNAG||layer==SC_LOG{return vec3<f32>(0.25,0.22,0.2);}return sc_species_base(layer).leaf_color;}
// Half width of a leaf blade at x (0 base .. 1 tip), relative to its length.
fn leaf_half_width(kind:u32,x:f32,y:f32,seed:u32)->f32{
 if x<0.0||x>1.0{return -1.0;}
 let serr=1.0+0.05*(abs(fract(x*18.0+f32(seed&7u)*0.13)-0.5)*2.0-0.5);
 switch kind{
  case 4u:{return 0.36*pow(sin(3.14159265*pow(x,0.85)),0.85)*serr;}
  case 5u:{return 0.36*(0.55+0.45*abs(sin(x*3.14159265*3.5+0.4)))*pow(sin(3.14159265*x),0.6);}
  case 7u,8u:{return 0.42*pow(1.0-x,0.9)*min(1.0,x*5.0)*serr;}
  case 9u:{return 0.11*pow(sin(3.14159265*x),1.1);}
  case 10u:{return 0.42*sqrt(max(0.0,1.0-pow(2.0*x-1.0,2.0)))*(1.0-0.25*smoothstep(0.9,1.0,x));}
  case 13u:{return 0.33*pow(sin(3.14159265*x),0.9);}
  case 12u:{return 0.32*pow(sin(3.14159265*x),0.8);}
  default:{return 0.03*(1.0-x*0.7);}
 }
}
// Palmate (maple): five pointed lobes around a centre at 0.45 of the length.
fn leaf_palmate(q:vec2<f32>)->f32{let c=q-vec2<f32>(0.42,0.0);let r=length(c);let a=atan2(c.y,c.x);let lobes=0.5+0.5*cos(5.0*a);return 0.2+0.36*pow(lobes,0.55)*smoothstep(-0.2,0.5,cos(a))-r;}
struct Stem {a:vec2<f32>,b:vec2<f32>,r:f32,leaf_from:f32,spacing:f32,len:f32,angle:f32,count:u32}
fn leaf_broad(kind:u32)->bool{return (kind>=LF_OVATE&&kind<=LF_ROUND)||kind==LF_SMALL;}
// A card shows a leafy spray: a main twig and alternating side twigs, each with its leaves (or needles). Lengths are in
// card units (the card spans 2), so a 1.3 m oak card carries about thirty 9-10 cm leaves.
fn leaf_stem(kind:u32,k:u32,seed:u32)->Stem{
 let main=Stem(vec2<f32>(0.03*(sc_random(seed)-0.5),-1.0),vec2<f32>(0.12*(sc_random(seed+1u)-0.5),0.92),0.022,0.1,0.13,0.45,0.75,1u);
 var s=main;
 if leaf_broad(kind){
  switch kind{
   case 4u:{s.spacing=0.085;s.len=0.30;s.angle=0.75;s.leaf_from=0.1;}
   case 5u:{s.spacing=0.07;s.len=0.34;s.angle=0.8;s.leaf_from=0.4;}
   case 6u:{s.spacing=0.15;s.len=0.36;s.angle=0.95;s.leaf_from=0.15;}
   case 7u:{s.spacing=0.07;s.len=0.24;s.angle=0.8;s.leaf_from=0.1;}
   case 8u:{s.spacing=0.08;s.len=0.28;s.angle=0.75;s.leaf_from=0.1;}
   case 9u:{s.spacing=0.06;s.len=0.38;s.angle=0.45;s.leaf_from=0.05;}
   case 10u:{s.spacing=0.085;s.len=0.27;s.angle=0.8;s.leaf_from=0.1;}
   default:{s.spacing=0.045;s.len=0.14;s.angle=0.8;s.leaf_from=0.05;}
  }
  s.len*=0.85+0.3*sc_random(seed+5u);
  if k>0u{let t=0.1+0.17*f32(k)+0.05*(sc_random(seed+2u)-0.5);let side=select(-1.0,1.0,(k&1u)==0u);s.a=mix(main.a,main.b,t);s.b=s.a+normalize(vec2<f32>(side*(0.75+0.3*sc_random(seed+3u)),0.8))*0.68*(1.0-0.45*t);s.r=0.013;s.leaf_from=select(0.1,0.35,kind==LF_LOBED);}
  return s;
 }
 switch kind{
  case 1u:{s.spacing=0.03;s.len=0.12;s.angle=0.95;s.leaf_from=0.05;s.r=0.016;if k>0u{let t=0.12+0.13*f32(k);let side=select(-1.0,1.0,(k&1u)==0u);s.a=mix(main.a,main.b,t);s.b=s.a+normalize(vec2<f32>(side*0.9,0.75))*0.62*(1.0-0.55*t);s.r=0.01;}}
  case 2u:{s.spacing=0.034;s.len=0.62;s.angle=0.45;s.leaf_from=0.35;s.r=0.024;if k>0u{let side=select(-1.0,1.0,(k&1u)==0u);s.a=mix(main.a,main.b,0.25+0.15*f32(k));s.b=s.a+normalize(vec2<f32>(side*0.7,0.8))*0.55;s.r=0.016;s.len=0.5;s.leaf_from=0.3;}}
  case 3u:{s.spacing=0.16;s.len=0.1;s.angle=1.0;s.leaf_from=0.08;s.r=0.016;if k>0u{let t=0.15+0.2*f32(k);let side=select(-1.0,1.0,(k&1u)==0u);s.a=mix(main.a,main.b,t);s.b=s.a+normalize(vec2<f32>(side*0.8,0.8))*0.55*(1.0-0.5*t);s.r=0.01;}}
  case 11u:{s.a=vec2<f32>(0.0,-1.0);s.b=vec2<f32>(0.0,1.0);s.spacing=0.045;s.len=0.92;s.angle=0.85;s.leaf_from=0.0;s.r=0.02;}
  case 12u:{s.spacing=0.02;s.len=0.05;s.angle=1.2;s.leaf_from=0.15;s.r=0.008;if k>0u{let t=0.1+0.14*f32(k);let side=select(-1.0,1.0,(k&1u)==0u);s.a=mix(main.a,main.b,t);s.b=s.a+normalize(vec2<f32>(side,0.55))*0.6*(1.0-0.4*t);s.r=0.007;}else{s.len=0.0;}}
  case 14u:{s.a=vec2<f32>(0.0,-1.0);s.b=vec2<f32>(0.0,0.98);s.spacing=0.07;s.len=0.62;s.angle=1.15;s.leaf_from=0.06;s.r=0.014;}
  case 0u:{s.len=0.0;if k>0u{let t=0.15+0.18*f32(k);let side=select(-1.0,1.0,(k&1u)==0u);s.a=mix(main.a,main.b,t);s.b=s.a+normalize(vec2<f32>(side*0.9,0.7))*0.5*(1.0-0.5*t);s.r=0.012;}}
  default:{s.spacing=0.16;s.len=0.48;s.angle=0.7;s.leaf_from=0.18;}
 }
 return s;
}
fn leaf_stems(kind:u32)->u32{if leaf_broad(kind){return select(5u,3u,kind==LF_PALMATE);}switch kind{case 1u:{return 7u;}case 2u:{return 3u;}case 3u:{return 4u;}case 12u:{return 7u;}case 0u:{return 5u;}default:{return 1u;}}}
fn leaf_eval(layer:u32,quad:u32,q:vec2<f32>)->LeafHit{
 let kind=leaf_layer_type(layer);let base=leaf_layer_color(layer);let seed=hash(layer*7919u+quad*104729u+bitcast<u32>(f.geo.z));
 var best=LeafHit(vec3<f32>(0),0.0,vec3<f32>(0,0,1),0.0,-1.0);
 let stems=leaf_stems(kind);
 for(var k=0u;k<stems;k++){
  let s=leaf_stem(kind,k,seed+k*31u);let d=s.b-s.a;let len2=max(dot(d,d),1e-6);let dl=sqrt(len2);let dir=d/dl;let side_v=vec2<f32>(-dir.y,dir.x);
  let t0=dot(q-s.a,d)/len2;
  // The stem itself.
  let tc=clamp(t0,0.0,1.0);let off=q-(s.a+d*tc);let sr=s.r*(1.0-0.6*tc);
  if length(off)<sr&&best.height<0.02{let shade=1.0-0.5*abs(dot(off,side_v))/sr;best=LeafHit(vec3<f32>(0.11,0.075,0.05)*mix(0.7,1.1,shade),1.0,normalize(vec3<f32>(side_v*dot(off,side_v)/sr*0.8,0.6)),0.0,0.02);}
  if s.len<=0.0||kind==LF_NONE{continue;}
  // Leaves whose bases lie within reach of this point along the stem (they point forward, toward the tip).
  let reach=s.len*cos(min(s.angle,1.2))/dl+0.08;let first=i32(floor((t0-reach-s.leaf_from)/(s.spacing/dl)))-1;let last=i32(ceil((t0-s.leaf_from)/(s.spacing/dl)))+1;
  for(var i=max(first,0);i<=min(last,i32(1.0/(s.spacing/dl))+1);i++){
   let ti=s.leaf_from+f32(i)*s.spacing/dl;if ti>1.0{break;}
   for(var sd=0u;sd<2u;sd++){
    let hl=hash(seed^(k*65537u+u32(i)*977u+sd*31u));
    // Opposite pairs (maple, fern, frond, spray) or alternate leaves.
    let opposite=kind==LF_PALMATE||kind==LF_FERN||kind==LF_FROND||kind==LF_SPRAY||kind==LF_BIPINNATE||kind==LF_TUFT;
    if !opposite&&sd==1u&&(u32(i)&1u)==0u{continue;}if !opposite&&sd==0u&&(u32(i)&1u)==1u{continue;}
    let sgn=select(-1.0,1.0,sd==0u);
    var ang=s.angle*(0.8+0.4*sc_random(hl))*sgn;var llen=s.len*(0.75+0.5*sc_random(hl+1u));
    if kind==LF_FROND||kind==LF_FERN{llen*=1.0-0.75*ti;}
    if kind==LF_SPRAY||kind==LF_BIPINNATE{llen*=1.0-0.35*ti;}
    if kind==LF_BUNDLE{ang=(sc_random(hl)-0.5)*1.3;llen=s.len*(0.7+0.3*sc_random(hl+1u))*min(1.0,(ti-0.25)*2.0);}
    let origin=s.a+d*ti;let ax=vec2<f32>(dir.x*cos(ang)-dir.y*sin(ang),dir.x*sin(ang)+dir.y*cos(ang));let px=vec2<f32>(-ax.y,ax.x);
    // Tufts: a rosette of short needles around each spur.
    if kind==LF_TUFT{
     let c=q-origin;let r=length(c);if r>llen{continue;}let a=atan2(c.y,c.x);let needles=18.0;let k2=fract(a/6.2831853*needles+sc_random(hl+5u));
     let wn=0.012/max(r,0.01);if abs(k2-0.5)>wn*needles*0.5+0.02{continue;}
     let h=0.3+0.4*r/llen+0.2*sc_random(hl+6u);
     if h>best.height{best=LeafHit(base*(0.85+0.3*sc_random(hl+7u))*mix(1.0,1.15,r/llen),1.0,normalize(vec3<f32>(c/max(r,1e-3)*0.3,0.9)),0.4,h);}
     continue;
    }
    let lq=q-origin;let x=dot(lq,ax)/max(llen,1e-4);let y=dot(lq,px)/max(llen,1e-4);
    var inside=-1.0;
    if kind==LF_PALMATE{inside=leaf_palmate(vec2<f32>(x,y));}
    else if kind==LF_SPRAY||kind==LF_BUNDLE{inside=select(-1.0,(0.018+0.01*(1.0-x))/max(llen,0.05)*0.6-abs(y),x>=0.0&&x<=1.0);}
    else if kind==LF_FROND||kind==LF_FERN{
     // A leaflet or pinna: itself a small blade; ferns add lobes.
     let hw=select(0.07,0.13,kind==LF_FERN)*pow(sin(3.14159265*clamp(x,0.0,1.0)),0.7);let lobes=select(1.0,0.75+0.25*abs(sin(x*28.0)),kind==LF_FERN);inside=select(-1.0,hw*lobes-abs(y),x>=0.0&&x<=1.0);
    }
    else{inside=leaf_half_width(kind,x,y,hl)-abs(y);}
    if inside<0.0{continue;}
    let h=0.15+0.7*sc_random(hl+2u)+0.1*x;
    if h<=best.height{continue;}
    // Colour: per-leaf variation, a pale midrib, darker veins and edges, now and then an old leaf.
    var col=base*(0.82+0.36*sc_random(hl+3u));col=mix(col,col*vec3<f32>(1.25,1.15,0.6),0.25*sc_random(hl+4u));
    if sc_random(hl+8u)<0.025&&kind>=LF_OVATE{col=mix(col,vec3<f32>(0.16,0.11,0.04),0.7);}
    let hw=max(abs(y)+inside,1e-4);let rib=1.0-smoothstep(0.0,0.035,abs(y)/max(hw,1e-3)*0.2);
    let veins=smoothstep(0.85,1.0,abs(fract((x+abs(y)*1.3)*9.0)-0.5)*2.0)*0.12*(1.0-rib);
    col=col*(1.0-veins)*mix(1.0,1.18,rib)*mix(0.8,1.0,smoothstep(0.0,0.05,inside));
    // Normal: roll about the leaf's axis and a fold along the midrib.
    let roll=(sc_random(hl+9u)-0.5)*1.1;let fold=sign(y)*0.35*(1.0-abs(y)/max(hw,1e-3));
    let n2=px*(sin(roll)+fold);let n=normalize(vec3<f32>(n2,1.0));
    best=LeafHit(col,1.0,n,select(1.0,0.45,kind==LF_SPRAY||kind==LF_BUNDLE||kind==LF_TUFT),h);
   }
  }
 }
 return best;
}
@compute @workgroup_size(8,8)
fn scenery_leaf_atlas(@builtin(global_invocation_id) id:vec3<u32>){
 let layer=sc_state.job_index;let size=textureDimensions(sc_leaf_color_out).x;if any(id.xy>=vec2<u32>(size))||layer>=SC_LEAF_LAYERS{return;}
 let half=size/2u;let quad=select(0u,1u,id.x>=half)+select(0u,2u,id.y>=half);let local=id.xy%vec2<u32>(half);
 var color=vec3<f32>(0);var alpha=0.0;var normal=vec3<f32>(0);var thick=0.0;var height=0.0;
 for(var s=0u;s<4u;s++){
  let o=vec2<f32>(f32(s&1u),f32(s>>1u))*0.5+0.25;let q=vec2<f32>((f32(local.x)+o.x)/f32(half)*2.0-1.0,1.0-(f32(local.y)+o.y)/f32(half)*2.0);
  let h=leaf_eval(layer,quad,q);if h.alpha>0.0{color+=h.color;alpha+=0.25;normal+=h.normal;thick+=h.thick;height+=max(h.height,0.0);}
 }
 let k=max(alpha*4.0,1.0);color/=k;thick/=k;height/=k;let n=select(vec3<f32>(0,0,1),normalize(normal),length(normal)>1e-4);
 // Within a card, deeper layers of leaves are shaded by those above them.
 color*=mix(0.72,1.0,clamp(height,0.0,1.0));
 textureStore(sc_leaf_color_out,vec2<i32>(id.xy),i32(layer),vec4<f32>(sqrt(color),alpha));
 textureStore(sc_leaf_normal_out,vec2<i32>(id.xy),i32(layer),vec4<f32>(n.xy*0.5+0.5,thick,clamp(height,0.0,1.0)));
}
// Leaf atlas mips: colour weighted by coverage; coverage kept toward the larger of the mean and the maximum, so that thin
// needles do not vanish under an alpha test as the card shrinks.
@group(0) @binding(144) var sc_leaf_color:texture_2d_array<f32>;
@group(0) @binding(145) var sc_leaf_normal:texture_2d_array<f32>;
@compute @workgroup_size(8,8)
fn scenery_leaf_mip(@builtin(global_invocation_id) id:vec3<u32>){
 if sc_state.job_kind!=3u||any(id.xy>=textureDimensions(sc_leaf_color_out)){return;}let layer=i32(sc_state.job_index);let xy=vec2<i32>(id.xy)*2;
 var c=vec3<f32>(0);var a=0.0;var amax=0.0;var nd=vec4<f32>(0);
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){let t=textureLoad(sc_leaf_color,xy+vec2<i32>(x,y),layer,0);let lin=t.rgb*t.rgb;c+=lin*t.a;a+=t.a;amax=max(amax,t.a);nd+=textureLoad(sc_leaf_normal,xy+vec2<i32>(x,y),layer,0)*t.a;}}
 let cov=mix(a*0.25,amax,0.35);
 textureStore(sc_leaf_color_out,vec2<i32>(id.xy),layer,vec4<f32>(sqrt(c/max(a,1e-5)),cov));
 textureStore(sc_leaf_normal_out,vec2<i32>(id.xy),layer,select(vec4<f32>(0.5,0.5,0.0,0.0),nd/max(a,1e-5),a>0.0));
}

// ---- Materials evaluated where a prop is drawn. Bark lies along each branch in cylindrical coordinates (metres around
// and along), rock in the rock's own frame, so strata and veins follow the object and differ from one object to the next.
struct ScMat {albedo:vec3<f32>,rough:f32,bump:vec2<f32>}
fn sc_cells(p:vec2<f32>,seed:u32)->vec3<f32>{
 // Distance to the nearest and second nearest jittered point, and the nearest cell's random value.
 let c=floor(p);var d1=9.0;var d2=9.0;var v=0.0;
 for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){let g=c+vec2<f32>(f32(i),f32(j));let h=hash(bitcast<u32>(i32(g.x))*73856093u^bitcast<u32>(i32(g.y))*19349663u^seed);let o=vec2<f32>(sc_random(h),sc_random(h+1u));let d=length(g+o-p);if d<d1{d2=d1;d1=d;v=sc_random(h+2u);}else if d<d2{d2=d;}}}
 return vec3<f32>(d1,d2,v);
}
fn sc_n2(p:vec2<f32>,seed:u32)->f32{return sc_vnoise(vec3<f32>(p,0.37),seed);}
// Bark height (0..1, high = outer surface) and albedo factor at (x around, y along), metres.
fn sc_bark_height(kind:u32,x:f32,y:f32,height:f32,seed:u32)->vec2<f32>{
 switch kind{
  case 0u:{let c=sc_cells(vec2<f32>(x*22.0,y*16.0),seed);return vec2<f32>(smoothstep(0.0,0.25,c.y-c.x),0.8+0.4*c.z);}
  case 1u:{
   let upper=smoothstep(0.45,0.7,height);let c=sc_cells(vec2<f32>(x*6.0,y*3.0+sc_n2(vec2<f32>(x*4.0,y),seed)*0.4),seed+3u);let crack=smoothstep(0.0,0.12,c.y-c.x);
   let flake=sc_n2(vec2<f32>(x*30.0,y*8.0),seed+7u)*0.15;return vec2<f32>(mix(crack*(0.85+flake),0.6+flake,upper),mix(0.75+0.35*c.z,1.0,upper)*mix(1.0,0.55+0.45*crack,1.0-upper));}
  case 2u:{let w=sc_n2(vec2<f32>(x*3.0,y*1.2),seed)*1.4;let ridge=1.0-abs(sin((x*16.0+w)*3.14159265));let brk=smoothstep(-0.2,0.4,sc_n2(vec2<f32>(x*9.0,y*5.0),seed+5u));return vec2<f32>(pow(ridge,0.6)*mix(0.55,1.0,brk),0.6+0.5*ridge);}
  case 3u:{let n=sc_n2(vec2<f32>(x*4.0,y*2.0),seed);let marks=smoothstep(0.92,1.0,abs(sin(y*7.0+n*2.0)))*0.15;return vec2<f32>(0.5+0.15*n-marks,0.92+0.12*n-marks);}
  case 4u:{
   let len=sc_cells(vec2<f32>(x*9.0,y*30.0),seed);let lent=smoothstep(0.16,0.05,len.x)*step(0.55,len.z);
   let blotch=smoothstep(0.25,0.6,sc_n2(vec2<f32>(x*2.5,y*1.5),seed+9u))*(1.0-smoothstep(0.08,0.25,height))+smoothstep(0.55,0.75,sc_n2(vec2<f32>(x*3.0,y*2.0),seed+11u))*0.6;
   return vec2<f32>(0.6-0.35*lent-0.3*blotch,mix(1.0,0.08,max(lent*0.9,blotch)));}
  case 5u:{let ring=smoothstep(0.75,0.95,abs(fract(y*8.5+0.2*sc_n2(vec2<f32>(x*2.0,y),seed))-0.5)*2.0);let fib=sc_n2(vec2<f32>(x*40.0,y*3.0),seed+3u)*0.2;return vec2<f32>(0.7-0.5*ring+fib,0.85-0.3*ring+fib);}
  case 6u:{let c=sc_cells(vec2<f32>(x*10.0,y*1.6),seed);let crack=smoothstep(0.0,0.06,c.y-c.x);let grain=sc_n2(vec2<f32>(x*60.0,y*4.0),seed+3u)*0.12;return vec2<f32>(crack*0.8+grain,0.75+0.3*crack+grain);}
  default:{let n=sc_n2(vec2<f32>(x*20.0,y*10.0),seed);return vec2<f32>(0.5+0.2*n,0.9+0.1*n);}
 }
}
fn sc_bark(species:u32,x:f32,y:f32,height:f32,radius:f32,footprint:f32,seed:u32,dead:bool)->ScMat{
 let sp=sc_species_base(species);var kind=sp.bark;var col=sp.bark_color;
 if dead&&kind!=BK_DEAD{kind=BK_DEAD;col=mix(col,vec3<f32>(0.3,0.28,0.26),0.6);}
 // Young, thin wood is smooth whatever the species.
 if radius<0.05&&kind!=BK_PAPERY&&kind!=BK_DEAD{kind=BK_SMOOTH;col=mix(col,col*vec3<f32>(1.1,0.95,0.85),0.5);}
 let e=0.004;let h=sc_bark_height(kind,x,y,height,seed);let hx=sc_bark_height(kind,x+e,y,height,seed).x;let hy=sc_bark_height(kind,x,y+e,height,seed).x;
 let fade=1.0-smoothstep(0.004,0.03,footprint);
 var albedo=col*mix(1.0,h.y,fade*0.9+0.1);
 if species==SC_PINE{albedo=mix(albedo,vec3<f32>(0.36,0.17,0.08)*h.y,smoothstep(0.45,0.7,height)*smoothstep(0.03,0.08,radius));}
 let depth=select(0.02,0.006,kind==BK_SMOOTH||kind==BK_PAPERY);
 return ScMat(albedo*mix(0.7,1.0,h.x),mix(0.95,0.8,h.x),vec2<f32>(hx-h.x,hy-h.x)/e*depth*fade);
}
// Rock albedo in the rock's own frame (metres), with this object's seed. wet 0..1 near water, moist 0..1, airless.
fn sc_rock_material(family:u32,p:vec3<f32>,n_up:f32,seed:u32,moist:f32,wet:f32,airless:bool,footprint:f32,low:f32)->ScMat{
 let q=p+vec3<f32>(sc_random(seed),sc_random(seed+1u),sc_random(seed+2u))*97.0;
 var base=vec3<f32>(0.30,0.29,0.27);
 switch family{
  case 0u:{base=mix(vec3<f32>(0.26,0.25,0.24),vec3<f32>(0.34,0.31,0.27),sc_random(seed+3u));}
  case 1u:{base=mix(vec3<f32>(0.42,0.33,0.22),vec3<f32>(0.36,0.24,0.17),sc_random(seed+3u));}
  case 2u:{base=mix(mix(vec3<f32>(0.22,0.22,0.23),vec3<f32>(0.38,0.34,0.28),sc_random(seed+3u)),vec3<f32>(0.14,0.14,0.15),step(0.8,sc_random(seed+4u)));}
  case 3u:{base=vec3<f32>(0.42,0.38,0.35);}
  case 4u:{base=mix(vec3<f32>(0.18,0.18,0.19),vec3<f32>(0.3,0.28,0.26),sc_random(seed+3u));}
  default:{base=vec3<f32>(0.26,0.25,0.24);}
 }
 let fine=1.0-smoothstep(0.003,0.02,footprint);let mid=1.0-smoothstep(0.03,0.25,footprint);
 var col=base*(0.85+0.3*sc_fbm(q*0.8,seed+5u,3u)*mid);
 // Mineral grain: granite's speckle of light and dark crystals; finer grit elsewhere.
 if family==3u{let g=sc_cells(q.xz*55.0+q.y*13.0,seed+6u);col=mix(col,select(vec3<f32>(0.62,0.55,0.5),vec3<f32>(0.08,0.08,0.08),g.z<0.25),step(0.6,abs(g.z-0.5)*2.0)*0.6*fine);}
 else{col*=1.0+0.18*sc_vnoise(q*60.0,seed+7u)*fine;}
 // Solar-System v2 along a dipping plane (slabs most, a hint in blocks), never the same bands on two rocks.
 let dip=normalize(vec3<f32>(sc_random(seed+8u)-0.5,2.5,sc_random(seed+9u)-0.5));let s=dot(q,dip)*select(1.2,3.5,family==1u)+sc_fbm(q*0.5,seed+10u,2u)*1.5;
 if family==1u||family==0u{col*=mix(1.0,0.82+0.3*sc_random(hash(u32(floor(s))+seed)),select(0.35,0.9,family==1u)*mid);}
 // Quartz veins: thin pale bands of one plane family.
 let vn=normalize(vec3<f32>(sc_random(seed+11u)-0.5,sc_random(seed+12u)-0.5,sc_random(seed+13u)-0.5));let vp=dot(q,vn)*1.7+0.4*sc_vnoise(q*1.3,seed+14u);
 let vein=(1.0-smoothstep(0.012,0.03,abs(fract(vp)-0.5)*0.5))*step(0.55,sc_random(seed+15u))*mid;col=mix(col,vec3<f32>(0.66,0.64,0.6),vein*0.8);
 // Weathering: exposed upper faces bleach a little; airless rock mantled with dust on top.
 col*=mix(0.88,1.08,smoothstep(-0.2,0.8,n_up));
 if airless{let dust=smoothstep(0.2,0.8,n_up)*0.6;col=mix(col,vec3<f32>(0.28,0.27,0.26),dust);}
 else{
  // Lichen rosettes and moss on the moist, upward and sheltered sides; desert varnish where it is dry.
  let lich=sc_cells(q.xz*3.0+q.y*0.7,seed+16u);let rosette=(1.0-smoothstep(0.18,0.32,lich.x))*step(0.45,lich.z)*smoothstep(0.1,0.6,n_up)*moist;
  col=mix(col,select(vec3<f32>(0.42,0.44,0.36),vec3<f32>(0.55,0.33,0.08),lich.z>0.85),rosette*0.85*mid);
  let moss=smoothstep(0.35,0.85,n_up+0.4*sc_fbm(q*1.2,seed+17u,2u))*smoothstep(0.45,0.85,moist);col=mix(col,vec3<f32>(0.05,0.09,0.025),moss*0.8);
  let varnish=(1.0-smoothstep(0.1,0.35,moist))*smoothstep(-0.1,0.5,n_up)*0.6;col=mix(col,vec3<f32>(0.10,0.06,0.04),varnish);
  // Wet near water: the lower part darkens.
  col*=mix(1.0,0.55,wet*(1.0-smoothstep(0.1,0.45,low)));
 }
 let rough=select(0.85,0.6,family==2u)*mix(1.0,0.55,wet*(1.0-smoothstep(0.1,0.45,low)));
 let e=0.01;let hb=sc_vnoise(q*25.0,seed+18u);let bump=vec2<f32>(sc_vnoise((q+vec3<f32>(e,0,0))*25.0,seed+18u)-hb,sc_vnoise((q+vec3<f32>(0,0,e))*25.0,seed+18u)-hb)/e*0.004*fine;
 return ScMat(col,rough,bump);
}
