/* Brand-decoratie voor nadirchajia.be — puur visueel.
   Hangt merk-shapes achter de foto's en plakt sticker-shapes erop.
   Raakt geen CMS-velden (data-cms) of teksten aan. */
(function () {
  var C = { spring:'#4e9f54', coral:'#e0794b', iris:'#7a6fc2', cream:'#f4ede1', green:'#1f3c2c' };
  function spark(c){ return "<svg viewBox='0 0 24 24' width='100%' height='100%'><path d='M12 0C13 9 15 11 24 12C15 13 13 15 12 24C11 15 9 13 0 12C9 11 11 9 12 0Z' fill='"+c+"'/></svg>"; }
  function arc(c){ return "<svg viewBox='0 0 120 62' width='100%' height='100%'><path d='M2 60 A58 58 0 0 1 118 60 Z' fill='"+c+"'/></svg>"; }
  var H="M120 120C80 84 60 60 60 36C60 16 74 4 92 4C106 4 116 14 120 26C124 14 134 4 148 4C166 4 180 16 180 36C180 60 160 84 120 120Z";
  function clover(c){ function g(r){return "<g transform='rotate("+r+" 120 120)'><path d='"+H+"'/></g>";} return "<svg viewBox='0 0 240 240' width='100%' height='100%' fill='"+c+"'>"+g(45)+g(135)+g(225)+g(315)+"</svg>"; }
  var SH = { spark:spark, arc:arc, clover:clover };

  function decorate(sel, items){
    var c = document.querySelector(sel);
    if(!c) return;
    if(getComputedStyle(c).position === 'static') c.style.position = 'relative';
    c.style.overflow = 'visible';
    items.forEach(function(it){
      var d = document.createElement('div');
      d.setAttribute('aria-hidden','true');
      d.style.cssText = 'position:absolute;pointer-events:none;width:'+it.size+'px;height:'+it.size+'px;z-index:'+it.z+';'+it.pos+(it.rot?('transform:rotate('+it.rot+'deg);'):'')+(it.op?('opacity:'+it.op+';'):'');
      d.innerHTML = SH[it.shape](C[it.color]);
      c.appendChild(d);
    });
  }

  function run(){
    decorate('.hero-portrait', [
      { shape:'clover', color:'iris',  size:150, z:-1, rot:-12, pos:'right:-44px;top:-42px;' },
      { shape:'spark',  color:'coral', size:60,  z:2,         pos:'left:-22px;bottom:46px;' }
    ]);
    decorate('.method-image', [
      { shape:'arc',   color:'spring', size:150, z:-1,       pos:'left:-36px;top:-30px;' },
      { shape:'spark', color:'coral',  size:52,  z:2,        pos:'right:-16px;bottom:-16px;' }
    ]);
    decorate('.about-image', [
      { shape:'clover', color:'coral', size:146, z:-1, rot:14, pos:'right:-44px;bottom:-42px;' },
      { shape:'spark',  color:'iris',  size:54,  z:2,          pos:'left:-18px;top:-18px;' }
    ]);
  }
  if(document.readyState !== 'loading') run(); else document.addEventListener('DOMContentLoaded', run);
})();
