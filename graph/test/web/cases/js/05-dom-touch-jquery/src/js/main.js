$(function () {
  $('.sidebar-toggle').on('click', function () {
    $('body').toggleClass('sidebar-collapse');
  });
  $(document).on('click', '.nav-link', handler);
  jQuery('<div class="modal fade"></div>').appendTo('body');
  $('#menu').find('li.active').closest('.tree').addClass('open');
  $panel.removeClass('hidden');
  [1, 2].find(function (x) { return x > 1; });
  $('.x').attr('data-k', 1).css('color', 'red');
});
