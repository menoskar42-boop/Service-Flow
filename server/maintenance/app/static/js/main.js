document.addEventListener('DOMContentLoaded', function () {
  // Auto-dismiss flash alerts after 5s
  document.querySelectorAll('.auto-dismiss').forEach(function (el) {
    setTimeout(function () {
      const a = bootstrap.Alert.getOrCreateInstance(el);
      if (a) a.close();
    }, 5000);
  });

  // Live photo preview on file input
  document.querySelectorAll('input[type="file"][data-preview]').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const preview = document.getElementById(this.dataset.preview);
      if (!preview || !this.files[0]) return;
      const reader = new FileReader();
      reader.onload = function (e) {
        preview.src = e.target.result;
        preview.style.display = 'block';
      };
      reader.readAsDataURL(this.files[0]);
    });
  });

  // Checklist radio: highlight parent item
  document.querySelectorAll('.checklist-radio').forEach(function (radio) {
    radio.addEventListener('change', function () {
      const item = this.closest('.checklist-item');
      if (!item) return;
      item.classList.remove('is-bad', 'is-good');
      if (this.value === 'bad' || this.value === 'yes') {
        item.classList.add('is-bad');
      } else {
        item.classList.add('is-good');
      }
    });
  });
});
