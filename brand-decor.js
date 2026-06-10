/* Brand-decoratie voor nadirchajia.be — puur visueel. Geen CMS-velden aangeraakt. */
(function () {
  var C = { spring:'#4e9f54', coral:'#e0794b', iris:'#7a6fc2', cream:'#f4ede1', green:'#1f3c2c', ochre:'#c68954', moss:'#8b9d7a' };
  function spark(c){ return "<svg viewBox='0 0 24 24' width='100%' height='100%'><path d='M12 0C13 9 15 11 24 12C15 13 13 15 12 24C11 15 9 13 0 12C9 11 11 9 12 0Z' fill='"+c+"'/></svg>"; }
  function arc(c){ return "<svg viewBox='0 0 120 62' width='100%' height='100%'><path d='M2 60 A58 58 0 0 1 118 60 Z' fill='"+c+"'/></svg>"; }
  var H="M120 120C80 84 60 60 60 36C60 16 74 4 92 4C106 4 116 14 120 26C124 14 134 4 148 4C166 4 180 16 180 36C180 60 160 84 120 120Z";
  function clover(c){ function g(r){return "<g transform='rotate("+r+" 120 120)'><path d='"+H+"'/></g>";} return "<svg viewBox='0 0 240 240' width='100%' height='100%' fill='"+c+"'>"+g(45)+g(135)+g(225)+g(315)+"</svg>"; }
  function rings(c){ return "<svg viewBox='0 0 120 120' width='100%' height='100%'><g fill='none' stroke='"+c+"' stroke-width='4'><circle cx='60' cy='60' r='56'/><circle cx='60' cy='60' r='40'/><circle cx='60' cy='60' r='24'/></g><circle cx='60' cy='60' r='7' fill='"+c+"'/></svg>"; }
  var SH = { spark:spark, arc:arc, clover:clover, rings:rings };

  function decorate(sel, items, peek){
    var c = document.querySelector(sel);
    if(!c) return;
    if(getComputedStyle(c).position === 'static') c.style.position = 'relative';
    if(peek) c.style.overflow = 'visible';
    items.forEach(function(it){
      var d = document.createElement('div');
      d.setAttribute('aria-hidden','true'); d.className='babl-decor';
      d.style.cssText = 'position:absolute;pointer-events:none;width:'+it.size+'px;height:'+it.size+'px;z-index:'+it.z+';'+it.pos+(it.rot?('transform:rotate('+it.rot+'deg);'):'')+(it.op?('opacity:'+it.op+';'):'');
      d.innerHTML = SH[it.shape](C[it.color]);
      c.appendChild(d);
    });
  }

  function run(){
    /* homepage foto's: shapes erachter (peek) + sticker erop */
    decorate('.hero-portrait', [
      { shape:'spark', color:'coral', size:58,  z:2,  pos:'right:18px;top:18px;' },
      { shape:'rings', color:'ochre', size:110, z:-1, pos:'right:28px;top:-46px;' }
    ], true);
    decorate('.method-image', [
      { shape:'arc',   color:'spring', size:150, z:-1, pos:'left:-36px;top:-30px;' },
      { shape:'spark', color:'coral',  size:52,  z:2,  pos:'right:-16px;bottom:-16px;' }
    ], true);
    decorate('.about-image', [
      { shape:'spark',  color:'iris',  size:54,  z:2,          pos:'left:-18px;top:-18px;' }
    ], true);
    /* secties: shapes binnen de hoeken (niet peeken, geen vierkant-uitlek) */
    decorate('.cta-final', [ { shape:'rings', color:'cream', size:180, z:-1, op:0.16, pos:'left:48px;top:44px;' } ], false);

    /* wandelcoaching-pagina */
    if(/wandelcoaching/.test(location.pathname)){
      decorate('.hero', [
        { shape:'clover', color:'spring', size:130, z:-1, op:0.55, pos:'right:44px;top:40px;' },
        { shape:'spark',  color:'coral',  size:58,  z:-1,          pos:'right:150px;bottom:54px;' }
      ], false);
      decorate('.interest', [
        { shape:'rings',  color:'cream', size:170, z:-1, op:0.16, pos:'left:48px;top:46px;' },
        { shape:'clover', color:'cream', size:150, z:-1, op:0.18, pos:'right:30px;bottom:24px;' }
      ], false);
      decorate('.pillars-header', [ { shape:'spark', color:'iris', size:56, z:-1, pos:'right:0;top:6px;' } ], false);
    }
  }
  if(document.readyState !== 'loading') run(); else document.addEventListener('DOMContentLoaded', run);
})();
