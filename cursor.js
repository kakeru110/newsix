(function () {
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { document.body.style.cursor = 'auto'; return; }

  var dot = document.createElement('div');
  dot.id = 'cursor-dot';
  document.body.appendChild(dot);

  window.addEventListener('mousemove', function (e) {
    dot.style.left = e.clientX + 'px';
    dot.style.top = e.clientY + 'px';
  });

  document.addEventListener('mouseover', function (e) {
    var row = e.target.closest('.entry');
    if (row) { dot.style.width = '26px'; dot.style.height = '26px'; }
  });
  document.addEventListener('mouseout', function (e) {
    var row = e.target.closest('.entry');
    if (row) { dot.style.width = '10px'; dot.style.height = '10px'; }
  });

  document.querySelectorAll('.entry').forEach(function (row) {
    row.addEventListener('mousemove', function (e) {
      var r = row.getBoundingClientRect();
      var x = (e.clientX - r.left - r.width / 2) / r.width;
      var y = (e.clientY - r.top - r.height / 2) / r.height;
      row.style.transform = 'translate(' + (x * 6) + 'px,' + (y * 4) + 'px)';
    });
    row.addEventListener('mouseleave', function () {
      row.style.transform = '';
    });
  });
})();
