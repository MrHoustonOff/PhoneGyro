'use strict';

  // ── Apple HIG Pop-up Button & Dropdown Select Manager ──────────────────────
  const AppleSelect = {
    instances: new Map(),
    activeDropdown: null,
    activeTrigger: null,

    init() {
      const selects = document.querySelectorAll('.setting-select, .cal-axis-select');
      selects.forEach(sel => this.attach(sel));

      // Close on document click outside
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.apple-select-trigger') && !e.target.closest('.apple-select-dropdown')) {
          this.closeAll();
        }
      });

      // Close on scroll or resize
      window.addEventListener('resize', () => this.closeAll(), { passive: true });
      window.addEventListener('wheel', (e) => {
        if (this.activeDropdown && !this.activeDropdown.contains(e.target)) {
          this.closeAll();
        }
      }, { passive: true });

      // Close on Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.activeDropdown) {
          this.closeAll();
        }
      });
    },

    attach(select) {
      if (!select || this.instances.has(select)) return;
      if (select.dataset.appleSelectReady === 'true') return;
      select.dataset.appleSelectReady = 'true';

      // Hide native select visually
      select.classList.add('apple-select-native-hidden');

      // Create Trigger Button
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'apple-select-trigger';
      if (select.id) trigger.id = `select-trigger-${select.id}`;
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      const label = document.createElement('span');
      label.className = 'apple-select-label';

      const arrows = document.createElement('span');
      arrows.className = 'apple-select-arrows';
      arrows.innerHTML = `
        <svg viewBox="0 0 10 14" width="9" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="2 5 5 2 8 5"></polyline>
          <polyline points="2 9 5 12 8 9"></polyline>
        </svg>
      `;

      trigger.appendChild(label);
      trigger.appendChild(arrows);

      // Insert trigger right after native select
      select.parentNode.insertBefore(trigger, select.nextSibling);

      // Create Dropdown Container (appended to document.body for zero-clipping)
      const dropdown = document.createElement('div');
      dropdown.className = 'apple-select-dropdown';
      dropdown.setAttribute('role', 'listbox');
      dropdown.style.display = 'none';
      document.body.appendChild(dropdown);

      const syncUI = () => {
        dropdown.innerHTML = '';
        const options = Array.from(select.options);
        const selectedVal = select.value;

        let activeOptText = '';

        options.forEach((opt, idx) => {
          const item = document.createElement('div');
          item.className = 'apple-select-option';
          item.setAttribute('role', 'option');
          item.dataset.value = opt.value;

          const isSelected = (opt.value === selectedVal) || (!selectedVal && idx === select.selectedIndex);
          if (isSelected) {
            item.classList.add('selected');
            item.setAttribute('aria-selected', 'true');
            activeOptText = opt.textContent;
          }

          const check = document.createElement('span');
          check.className = 'apple-select-check';
          check.innerHTML = `
            <svg viewBox="0 0 12 10" width="10" height="8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1.5 5 4.5 8 10.5 1.5"></polyline>
            </svg>
          `;

          const text = document.createElement('span');
          text.className = 'apple-select-opt-text';
          text.textContent = opt.textContent;

          // Optional second line "when to pick it": <option data-desc-i18n="key">.
          const descKey = opt.getAttribute('data-desc-i18n');
          const descText = descKey && window.I18n ? I18n.t(descKey) : '';
          if (descText && descText !== descKey) {
            item.classList.add('has-desc');
            const desc = document.createElement('span');
            desc.className = 'apple-select-opt-desc';
            desc.textContent = descText;
            text.appendChild(desc);
          }

          item.appendChild(check);
          item.appendChild(text);

          item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (select.value !== opt.value) {
              select.value = opt.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              select.dispatchEvent(new Event('input', { bubbles: true }));
            }
            this.closeAll();
            trigger.focus();
          });

          dropdown.appendChild(item);
        });

        if (!activeOptText && select.options[select.selectedIndex]) {
          activeOptText = select.options[select.selectedIndex].textContent;
        }
        label.textContent = activeOptText;
      };

      syncUI();

      // Trigger Click
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.activeDropdown === dropdown) {
          this.closeAll();
        } else {
          this.open(trigger, dropdown);
        }
      });

      // Trigger Keyboard Navigation
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (this.activeDropdown !== dropdown) {
            this.open(trigger, dropdown);
          } else {
            const items = Array.from(dropdown.querySelectorAll('.apple-select-option'));
            const currentIdx = select.selectedIndex;
            if (e.key === 'ArrowDown' && currentIdx < items.length - 1) {
              select.selectedIndex = currentIdx + 1;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (e.key === 'ArrowUp' && currentIdx > 0) {
              select.selectedIndex = currentIdx - 1;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (e.key === 'Enter' || e.key === ' ') {
              this.closeAll();
            }
          }
        }
      });

      // Intercept select.value property changes
      const proto = HTMLSelectElement.prototype;
      const nativeDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (nativeDescriptor) {
        Object.defineProperty(select, 'value', {
          get() {
            return nativeDescriptor.get.call(this);
          },
          set(val) {
            nativeDescriptor.set.call(this, val);
            syncUI();
          },
          configurable: true
        });
      }

      // Native change listener
      select.addEventListener('change', syncUI);

      this.instances.set(select, { trigger, dropdown, syncUI });
    },

    open(trigger, dropdown) {
      this.closeAll();

      dropdown.style.display = 'block';
      dropdown.style.visibility = 'hidden';
      const zoom = parseFloat(document.documentElement.style.zoom) || (window.FontScaleManager && FontScaleManager.scale) || 1.0;
      const ddRect = dropdown.getBoundingClientRect();
      const dropdownWidth = ddRect.width || (dropdown.offsetWidth * zoom);
      const dropdownHeight = ddRect.height || (dropdown.offsetHeight * zoom);
      dropdown.style.visibility = 'visible';

      const rect = trigger.getBoundingClientRect();
      let left = rect.right - dropdownWidth;
      if (left < 10) left = rect.left;
      if (left + dropdownWidth > window.innerWidth - 10) {
        left = window.innerWidth - dropdownWidth - 10;
      }

      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      let top;
      if (spaceBelow < dropdownHeight + 12 && spaceAbove > dropdownHeight) {
        top = rect.top - dropdownHeight - 5;
        dropdown.classList.add('open-up');
      } else {
        top = rect.bottom + 5;
        dropdown.classList.remove('open-up');
      }

      dropdown.style.left = `${Math.round(left / zoom)}px`;
      dropdown.style.top = `${Math.round(top / zoom)}px`;

      requestAnimationFrame(() => {
        dropdown.classList.add('visible');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
      });

      this.activeDropdown = dropdown;
      this.activeTrigger = trigger;
    },

    closeAll() {
      if (this.activeDropdown) {
        this.activeDropdown.classList.remove('visible');
        const d = this.activeDropdown;
        setTimeout(() => {
          if (!d.classList.contains('visible')) {
            d.style.display = 'none';
          }
        }, 140);
        this.activeDropdown = null;
      }
      if (this.activeTrigger) {
        this.activeTrigger.classList.remove('active');
        this.activeTrigger.setAttribute('aria-expanded', 'false');
        this.activeTrigger = null;
      }
    },

    refreshAll() {
      this.instances.forEach(({ syncUI }) => {
        syncUI();
      });
    }
  };
