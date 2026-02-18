/* User:ماهر سامي/QuickReplies.js
 * ------------------------------------------------------------
 *   أداة "ردود سريعة" (Quick Replies) — للإضافة داخل مربع الرد
 *   المؤلف: ماهر سامي
 * ------------------------------------------------------------
 * وصف الأداة:
 * سكربت مخصص لصفحات النقاش في ويكيبيديا العربية، يضيف
 * قائمة ردود جاهزة داخل شريط أدوات الرد (DiscussionTools)،
 * بحيث يمكن إدراج ردود متكررة بنقرة واحدة داخل حقل النص.
 * يدعم إدراج النص بشكل صحيح مع VisualEditor (وضع الويكي‌تكست)
 * حتى عند تفعيل CodeMirror، عبر الإدراج من نموذج VE بدل الاعتماد
 * على textarea الوهمي.
 *
 * الميزات:
 * - إدراج ردود جاهزة داخل شريط أدوات الرد في DiscussionTools
 * - مدير قوالب مدمج لإضافة القوالب وتعديلها وحذفها
 * - تخزين القوالب في صفحة JSON ضمن نطاق المستخدم
 * - دعم المتغير {USER} لإدراج اسم المستخدم المُجاب عليه تلقائيًا
 * - توافق عملي مع VisualEditor wikitext + CodeMirror overlay
 * - منطق إدراج يعتمد على نموذج VE لتفادي مشاكل textarea الوهمي
 * - سجلات Debug اختيارية لتسهيل التتبع والإصلاح
 *
 * التخزين:
 * - User:اسم_المستخدم/QuickReplies.json
 *   الصيغة: مصفوفة كائنات { label, text }
 *
 * الإصدار: 1.0
 * تاريخ آخر تعديل: 18 فبراير 2026
 *
 * ملاحظات:
 * هذه نسخة قابلة للتطوير بالتعاون مع مجتمع ويكيبيديا العربية.
 * يُرجى الإبلاغ عن المشاكل أو اقتراحات التحسين في صفحة نقاش الأداة.
 * ------------------------------------------------------------
 */
(function () {
  'use strict';


  if (typeof mw === 'undefined' || typeof $ === 'undefined') {
    return;
  }

  function shouldRunHere() {
    const ns = mw.config.get('wgNamespaceNumber');
    const action = mw.config.get('wgAction');
    const isTalkPage = ns % 2 === 1 || ns === 4;
    return (isTalkPage || ns === 3) && (action === 'view' || action === 'edit');
  }

  if (!shouldRunHere()) {
    return;
  }

  const QR_CM_VE = new Set();

  mw.hook('ext.CodeMirror.ready').add(function (cm) {
    try {
      if (cm && cm.surface && cm.surfaceView && cm.view) {
        QR_CM_VE.add(cm);
      }
    } catch (e) {
    }
  });

  mw.hook('ext.CodeMirror.destroy').add(function (cm) {
    try { 
      QR_CM_VE.delete(cm);
    } catch (e) {}
  });

  function findCMVEForWidget($widget) {
    const widgetEl = $widget && $widget[0];
    if (!widgetEl) return null;

    for (const cm of QR_CM_VE) {
      try {
        const root = cm.surfaceView?.$attachedRootNode?.[0];
        if (root && widgetEl.contains(root)) {
          return cm;
        }
      } catch (e) {}
    }
    return null;
  }

  const SELECTORS = {
    REPLY_WIDGET: '.ext-discussiontools-ui-replyWidget, .ext-discussiontools-replywidget',
    TOOLBAR: '.oo-ui-toolbar-bar',
    COMMENT: '.ext-discussiontools-comment',
    USER_LINK: 'a.mw-userlink',
    TEXTAREA: 'textarea'
  };

  const CONFIG = {
    SELECT_MARGIN: '8px',
    SELECT_MAX_WIDTH: '220px',
    SELECT_HEIGHT: '30px',
    DEBOUNCE_DELAY: 100,
    DEFAULT_USERNAME: 'اسم المستخدم',
    JSON_PAGE: 'User:' + mw.config.get('wgUserName') + '/QuickReplies.json'
  };

  const DEFAULT_REPLIES = [
    {
      label: 'ترحيب + إنشاء صفحة',
      text:
        'مرحبًا [[مستخدم:{USER}|{USER}]]، أهلًا وسهلًا بك في ويكيبيديا العربية. ' +
        'لإنشاء صفحة جديدة، يُستحسن البدء بصياغتها في [[ويكيبيديا:ملعب|الملعب]] مع إرفاق [[ويكيبيديا:مصادر موثوق بها|مصادر موثوقة]] لكل معلومة، ' +
        'وتجنّب [[ويكيبيديا:حقوق التأليف والنشر|خرق حقوق النشر]]. بعد اكتمال المقالة واستيفائها للشروط، يمكن نقلها إلى نطاق المقالات. تحياتي.'
    },
    {
      label: 'تنبيه: أضيفي مصادر',
      text:
        'مرحبًا [[مستخدم:{USER}|{USER}]]، شكرًا لمساهمتك. يُستحسن إرفاق مصادر موثوقة لأي معلومة تُضاف، خصوصًا إن كانت مثار خلاف. تحياتي.'
    },
    {
      label: 'تنبيه: حقوق نشر',
      text:
        'مرحبًا [[مستخدم:{USER}|{USER}]]، تنبيه سريع: يُرجى عدم نسخ نصوص من مواقع أخرى لتفادي خرق حقوق النشر، ويمكن بدلًا من ذلك إعادة الصياغة مع الاستشهاد بمصادر. تحياتي.'
    }
  ];

  let QUICK_REPLIES = [];
  let customRepliesCache = null;
  let loadingPromise = null;
  let firstTimeNoticeShown = false;

  async function loadCustomReplies() {
    if (customRepliesCache !== null) {
      return customRepliesCache;
    }

    if (loadingPromise) {
      return loadingPromise;
    }

    loadingPromise = (async () => {
      try {
        const api = new mw.Api();
        const response = await api.get({
          action: 'query',
          prop: 'revisions',
          titles: CONFIG.JSON_PAGE,
          rvprop: 'content',
          rvslots: 'main',
          formatversion: 2
        });

        const page = response.query.pages[0];
        if (page.missing) {
          customRepliesCache = [];
          return [];
        }

        const content = page.revisions[0].slots.main.content;
        try {
          customRepliesCache = JSON.parse(content);
          return customRepliesCache;
        } catch (parseError) {
          mw.notify(
            'تنبيه: ملف الردود المخصصة يحتوي على أخطاء. يرجى مراجعة ' + CONFIG.JSON_PAGE,
            { type: 'error', tag: 'quickreplies-json-error' }
          );
          customRepliesCache = [];
          return [];
        }
      } catch (error) {
        customRepliesCache = [];
        return [];
      } finally {
        loadingPromise = null;
      }
    })();

    return loadingPromise;
  }


  async function saveCustomReplies(replies) {
    try {
      const api = new mw.Api();
      const content = JSON.stringify(replies, null, 2);
      
      await api.postWithToken('csrf', {
        action: 'edit',
        title: CONFIG.JSON_PAGE,
        text: content,
        summary: 'تحديث الردود السريعة المخصصة',
        contentmodel: 'json'
      });

      customRepliesCache = replies;
      await refreshReplies();
      return true;
    } catch (error) {
      mw.notify('فشل حفظ القوالب. تأكد من تسجيل دخولك.', { type: 'error' });
      return false;
    }
  }

  async function refreshReplies() {
    const customReplies = await loadCustomReplies();
    QUICK_REPLIES = [...DEFAULT_REPLIES, ...customReplies];
  }

  async function openTemplateManager() {
    const customReplies = await loadCustomReplies();
    
    let html = '<div style="font-family: Arial, sans-serif;">';
    html += '<h3 style="margin-top: 0;">إدارة الردود السريعة المخصصة</h3>';
    html += '<div id="qr-templates-list" style="max-height: 300px; overflow-y: auto; margin-bottom: 15px;">';
    
    if (customReplies.length === 0) {
      html += '<p style="color: #666; font-style: italic;">لا توجد قوالب مخصصة بعد</p>';
    } else {
      customReplies.forEach((reply, idx) => {
        html += '<div style="border: 1px solid #ddd; padding: 10px; margin-bottom: 10px; border-radius: 4px;">';
        html += '<div style="display: flex; justify-content: space-between; align-items: start;">';
        html += '<div style="flex: 1;">';
        html += '<strong>' + mw.html.escape(reply.label) + '</strong>';
        html += '<div style="color: #666; font-size: 12px; margin-top: 5px; white-space: pre-wrap;">' + 
                mw.html.escape(reply.text.substring(0, 100)) + (reply.text.length > 100 ? '...' : '') + '</div>';
        html += '</div>';
        html += '<div style="margin-inline-start: 10px;">';
        html += '<button class="qr-edit-btn" data-idx="' + idx + '" style="margin-inline-end: 5px; padding: 5px 10px; cursor: pointer;">تعديل</button>';
        html += '<button class="qr-delete-btn" data-idx="' + idx + '" style="padding: 5px 10px; cursor: pointer; background: #d33; color: white; border: none; border-radius: 3px;">حذف</button>';
        html += '</div></div></div>';
      });
    }
    
    html += '</div>';
    html += '<button id="qr-add-new" style="padding: 8px 15px; background: #36c; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">➕ إضافة قالب جديد</button>';
    html += '</div>';
    
    const $dialog = $('<div>').html(html);
    
    $dialog.on('click', '.qr-delete-btn', async function() {
      const idx = Number($(this).data('idx'));
      if (confirm('هل أنت متأكد من حذف هذا القالب؟')) {
        customReplies.splice(idx, 1);
        const saved = await saveCustomReplies(customReplies);
        $dialog.dialog('close');
        if (saved) {
          await openTemplateManager();
        }
      }
    });
    
    $dialog.on('click', '.qr-edit-btn', function() {
      const idx = Number($(this).data('idx'));
      openTemplateEditor(customReplies[idx], idx);
      $dialog.dialog('close');
    });
    
    $dialog.on('click', '#qr-add-new', function() {
      openTemplateEditor(null, -1);
      $dialog.dialog('close');
    });
    
    $dialog.dialog({
      title: 'إدارة الردود السريعة',
      width: 600,
      modal: true,
      buttons: [{
        text: 'إغلاق',
        click: function() {
          $(this).dialog('close');
        }
      }]
    });
  }

  async function openTemplateEditor(template, index) {
    const isEdit = template !== null;
    const label = isEdit ? template.label : '';
    const text = isEdit ? template.text : '';
    
    if (!isEdit && !firstTimeNoticeShown) {
      const customReplies = await loadCustomReplies();
      if (customReplies.length === 0) {
        firstTimeNoticeShown = true;
        
        const noticeHtml = '<div style="font-family: Arial, sans-serif;">' +
          '<div style="background: #eaf3ff; border: 1px solid #36c; border-radius: 4px; padding: 15px; margin-bottom: 15px;">' +
          '<h4 style="margin: 0 0 10px 0; color: #36c;">📝 معلومة هامة</h4>' +
          '<p style="margin: 0; line-height: 1.6;">سيتم إنشاء صفحة JSON في نطاقك الشخصي:</p>' +
          '<p style="margin: 10px 0; padding: 8px; background: white; border-radius: 3px; font-family: monospace; direction: ltr; text-align: left;">' +
          mw.html.escape(CONFIG.JSON_PAGE) + '</p>' +
          '<p style="margin: 0; line-height: 1.6; font-size: 13px; color: #555;">' +
          'سيتم حفظ الردود المخصصة في هذا الملف، وستتزامن تلقائياً على جميع أجهزتك.' +
          '</p>' +
          '</div>' +
          '</div>';
        
        const $notice = $('<div>').html(noticeHtml);
        $notice.dialog({
          title: 'حفظ الردود المخصصة',
          width: 500,
          modal: true,
          buttons: [{
            text: 'فهمت، المتابعة',
            click: function() {
              $(this).dialog('close');
              setTimeout(() => showTemplateEditor(template, index, isEdit, label, text), 300);
            }
          }, {
            text: 'إلغاء',
            click: function() {
              $(this).dialog('close');
              openTemplateManager();
            }
          }]
        });
        return;
      }
    }
    
    showTemplateEditor(template, index, isEdit, label, text);
  }

  function showTemplateEditor(template, index, isEdit, label, text) {
    let html = '<div style="font-family: Arial, sans-serif;">';
    html += '<div style="margin-bottom: 15px;">';
    html += '<label style="display: block; margin-bottom: 5px; font-weight: bold;">عنوان القالب:</label>';
    html += '<input type="text" id="qr-template-label" value="' + mw.html.escape(label) + '" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">';
    html += '</div>';
    html += '<div style="margin-bottom: 15px;">';
    html += '<label style="display: block; margin-bottom: 5px; font-weight: bold;">نص القالب:</label>';
    html += '<textarea id="qr-template-text" rows="8" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;">' + mw.html.escape(text) + '</textarea>';
    html += '<small style="color: #666;">يمكنك استخدام {USER} للإشارة إلى اسم المستخدم</small>';
    html += '</div>';
    html += '</div>';
    
    const $dialog = $('<div>').html(html);
    
    $dialog.dialog({
      title: isEdit ? 'تعديل القالب' : 'إضافة قالب جديد',
      width: 550,
      modal: true,
      buttons: [{
        text: 'حفظ',
        click: async function() {
          const newLabel = $('#qr-template-label').val().trim();
          const newText = $('#qr-template-text').val().trim();
          
          
          if (!newLabel || !newText) {
            alert('يرجى ملء جميع الحقول');
            return;
          }
          
          const customReplies = await loadCustomReplies();
          const newTemplate = { label: newLabel, text: newText };
          
          if (isEdit) {
            customReplies[index] = newTemplate;
          } else {
            customReplies.push(newTemplate);
          }
          
          const saved = await saveCustomReplies(customReplies);
          $(this).dialog('close');
          
          if (saved) {
            mw.notify('تم حفظ القالب بنجاح', { type: 'success' });
            
            setTimeout(async function() {
              await openTemplateManager();
            }, 500);
          }
        }
      }, {
        text: 'إلغاء',
        click: function() {
          $(this).dialog('close');
          openTemplateManager();
        }
      }]
    });
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function qrCleanBidi(s) {
    return (s || '')
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function qrGetReplyToUser($widget) {
    if (!$widget || !$widget.length) return '';

    let label = $widget
      .find('.ve-ce-rootNode[role="textbox"][aria-label]')
      .first()
      .attr('aria-label');

    if (!label) {
      label = $widget
        .find('.ve-ui-surface-placeholder p')
        .first()
        .text();
    }

    label = qrCleanBidi(label);

    const m = label.match(/(?:رُدَّ|ردّ|رد)\s*على\s*(.+)$/);
    if (!m) return '';

    return qrCleanBidi(m[1]).replace(/[،.]+$/g, '').trim();
  }

  function qrApplyPlaceholders(text, $widget) {
    const replyTo = qrGetReplyToUser($widget);
    if (!replyTo) {
      return text;
    }
    return String(text).replace(/\{USER\}/g, replyTo);
  }

  function findReplyTextarea($widget) {
    try {
      return $widget.find('textarea').first();
    } catch (error) {
      return $();
    }
  }

  function findVisibleReplyTextarea($widget) {
    try {
      return $widget.find('textarea:visible').first();
    } catch (error) {
      return $();
    }
  }

  function trySwitchToSource($widget) {
    const $btn = $widget.find('button, a').filter(function () {
      return $(this).text().trim() === 'مصدر';
    }).first();
    if ($btn.length) {
      $btn.trigger('click');
      return true;
    }
    return false;
  }

  function insertAtCursor(textarea, text) {
    try {
      
      const $ta = $(textarea);
      const $widget = $ta.closest(SELECTORS.REPLY_WIDGET);
      
      const cmVe = findCMVEForWidget($widget);
      if (cmVe) {
        try {
          cmVe.surfaceView.focus();
          const model = cmVe.surface.getModel();
          model.getFragment().insertContent(text);
          return;
        } catch (e) {
        }
      }
      
      

      let cmInstance = null;
      
      if (textarea.CodeMirror) {
        cmInstance = textarea.CodeMirror;
      }
      
      if (!cmInstance) {
        const $cmElement = $widget.find('.CodeMirror');
        if ($cmElement.length) {
          for (let i = 0; i < $cmElement.length; i++) {
            if ($cmElement[i].CodeMirror) {
              cmInstance = $cmElement[i].CodeMirror;
              break;
            }
          }
        }
      }
      
      if (!cmInstance) {
        $widget.find('*').each(function() {
          if (this.CodeMirror) {
            cmInstance = this.CodeMirror;
            return false;
          }
        });
      }
      
      if (!cmInstance) {
        const $cmContent = $widget.find('.cm-content');
        if ($cmContent.length) {
          const $cm6 = $cmContent.closest('.cm-editor');
          
          if ($cm6.length) {
            const cm6Element = $cm6[0];
            let view = null;
            
            if (cm6Element.cmView) {
              view = cm6Element.cmView.view || cm6Element.cmView;
            } else if (cm6Element.CodeMirror) {
              view = cm6Element.CodeMirror;
            }
            
            if (!view) {
              for (let prop in cm6Element) {
                if (cm6Element[prop] && typeof cm6Element[prop] === 'object') {
                  if (cm6Element[prop].state && cm6Element[prop].dispatch) {
                    view = cm6Element[prop];
                    break;
                  }
                }
              }
            }
            
            if (view && view.state && view.dispatch) {
              try {
                view.dispatch({
                  changes: { from: view.state.selection.main.head, insert: text }
                });
                view.focus();
                return;
              } catch (e) {
              }
            } else {
            }
          }
        }
      }
      
      if (cmInstance) {
        const doc = cmInstance.getDoc();
        const cursor = doc.getCursor();
        doc.replaceRange(text, cursor);
        cmInstance.focus();
        return;
      }
      
      
      if (textarea.className && textarea.className.indexOf('ve-dummyTextbox') !== -1) {
        
        try {
          let surface = null;
          
          $widget.find('*').each(function() {
            if (this.surface) {
              surface = this.surface;
              return false;
            }
            
            for (let prop in this) {
              try {
                if (this[prop] && typeof this[prop] === 'object' && this[prop].getModel && this[prop].getView) {
                  surface = this[prop];
                  return false;
                }
              } catch (e) {
              }
            }
          });
          
          if (!surface && typeof mw !== 'undefined' && mw.dt) {
          }
          
          if (!surface) {
            const $ce = $widget.find('[contenteditable="true"]').first();
            if ($ce.length) {
              $ce.parents().each(function() {
                if (this.surface) {
                  surface = this.surface;
                  return false;
                }
              });
            }
          }
          
          if (surface && surface.getModel) {
            try {
              const model = surface.getModel();
              const fragment = model.getFragment();
              fragment.insertContent(text);
              return;
            } catch (e) {
            }
          } else {
          }
        } catch (e) {
        }
        

        let $contentEditable = $widget.find('.ve-ce-documentNode[contenteditable="true"]');
        if (!$contentEditable.length) {
          $contentEditable = $widget.find('[contenteditable="true"]').filter(function() {
            return $(this).is('div, p') && !$(this).hasClass('ve-ce-branchNode-slug');
          });
        }
        if (!$contentEditable.length) {
          $contentEditable = $widget.find('div[contenteditable="true"]');
        }
        
        
        if ($contentEditable.length) {
          const el = $contentEditable[0];
          
          el.focus();
          
          const sel = window.getSelection();
          if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            let node = range.startContainer;
            
            let $node = $(node).closest('.ve-ce-branchNode-slug');
            if ($node.length) {
              
              const $paragraph = $(el).find('p.ve-ce-paragraphNode').first();
              if ($paragraph.length) {
                const newRange = document.createRange();
                const paragraphNode = $paragraph[0];
                
                let textNode = null;
                for (let i = 0; i < paragraphNode.childNodes.length; i++) {
                  const child = paragraphNode.childNodes[i];
                  if (child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0) {
                    textNode = child;
                    break;
                  }
                }
                
                if (!textNode) {
                  textNode = document.createTextNode('');
                  paragraphNode.insertBefore(textNode, paragraphNode.firstChild);
                }
                
                newRange.setStart(textNode, textNode.length);
                newRange.setEnd(textNode, textNode.length);
                sel.removeAllRanges();
                sel.addRange(newRange);
              }
            }
          }
          
          try {
            const sel = window.getSelection();
            if (sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              
              range.deleteContents();
              
              const textNode = document.createTextNode(text);
              range.insertNode(textNode);
              
              range.setStartAfter(textNode);
              range.setEndAfter(textNode);
              sel.removeAllRanges();
              sel.addRange(range);
              

              const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: false,
                inputType: 'insertText',
                data: text
              });
              el.dispatchEvent(inputEvent);
              
              const beforeInputEvent = new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: text
              });
              el.dispatchEvent(beforeInputEvent);
              
              return;
            }
          } catch (e) {
          }
          
          try {
            const success = document.execCommand('insertText', false, text);
            if (success) {
              
              const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: false,
                inputType: 'insertText',
                data: text
              });
              el.dispatchEvent(inputEvent);
              return;
            }
          } catch (e) {
          }
          
          try {
            const sel = window.getSelection();
            const range = sel.getRangeAt(0);
            
            range.deleteContents();
            
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            sel.removeAllRanges();
            sel.addRange(range);
            
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            
            return;
          } catch (e) {
          }
          
          try {
            const currentHTML = el.innerHTML;
            el.innerHTML = currentHTML + text;
            
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
            
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            
            return;
          } catch (e) {
          }
        } else {
        }
      }
      
      const el = textarea;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      

      const before = el.value.slice(0, start);
      const after = el.value.slice(end);

      const prefix = (after.length === 0 && before.length && !before.endsWith('\n') && !text.startsWith('\n')) ? '\n' : '';
      const suffix = (after.length && !after.startsWith('\n') && !text.endsWith('\n')) ? '\n' : '';

      const newValue = before + prefix + text + suffix + after;
      
      el.value = newValue;

      const pos = (before + prefix + text + suffix).length;
      el.selectionStart = el.selectionEnd = pos;
      
      el.dispatchEvent(new Event('input', { bubbles: true }));
      
      el.dispatchEvent(new Event('change', { bubbles: true }));
      
      el.focus();
      
    } catch (error) {
    }
  }

  function openQuickRepliesDialog($widget) {
    let html = '<div style="font-family: Arial, sans-serif;">';
    html += '<div style="margin-bottom: 15px;">';
    html += '<input type="text" id="qr-search-box" placeholder="🔍 ابحث عن قالب..." style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">';
    html += '</div>';
    html += '<div id="qr-replies-list" style="max-height: 400px; overflow-y: auto;">';
    
    QUICK_REPLIES.forEach((reply, idx) => {
      const isCustom = idx >= DEFAULT_REPLIES.length;
      const bgColor = isCustom ? '#f0f8ff' : '#fff';
      
      html += '<div class="qr-reply-item" data-idx="' + idx + '" style="border: 1px solid #ddd; margin-bottom: 10px; border-radius: 4px; overflow: hidden; background: ' + bgColor + ';">';
      html += '<div class="qr-reply-header" style="padding: 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(to bottom, #fafafa, #f5f5f5); border-bottom: 1px solid #e0e0e0;">';
      html += '<div style="flex: 1;">';
      html += '<strong style="font-size: 14px; color: #202122;">' + mw.html.escape(reply.label) + '</strong>';
      if (isCustom) html += ' <span style="font-size: 11px; color: #72777d; background: #eaecf0; padding: 2px 6px; border-radius: 2px;">مخصص</span>';
      html += '</div>';
      html += '<span class="qr-expand-icon" style="color: #72777d; font-size: 18px;">▼</span>';
      html += '</div>';
      html += '<div class="qr-reply-content" style="display: none; padding: 15px; background: ' + bgColor + ';">';
      html += '<div style="background: #f8f9fa; padding: 12px; border-radius: 4px; margin-bottom: 12px; border: 1px solid #eaecf0; direction: rtl;">';
      html += '<pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: Arial, sans-serif; font-size: 13px; line-height: 1.6; color: #202122;">' + mw.html.escape(reply.text) + '</pre>';
      html += '</div>';
      html += '<div style="text-align: left;">';
      html += '<button class="qr-insert-btn" data-idx="' + idx + '" style="padding: 8px 16px; background: #36c; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 13px;">✓ إضافة إلى الرد</button>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
    });
    
    html += '</div>';
    html += '</div>';
    
    const $dialog = $('<div>').html(html);
    
    $dialog.on('click', '.qr-reply-header', function() {
      const $item = $(this).closest('.qr-reply-item');
      const $content = $item.find('.qr-reply-content');
      const $icon = $item.find('.qr-expand-icon');
      
      if ($content.is(':visible')) {
        $content.slideUp(200);
        $icon.text('▼');
      } else {
        $content.slideDown(200);
        $icon.text('▲');
      }
    });
    
    $dialog.on('click', '.qr-insert-btn', function() {
      const idx = Number($(this).data('idx'));
      const reply = QUICK_REPLIES[idx];
      const txt = qrApplyPlaceholders(reply.text, $widget);
      
      
      let $ta = findVisibleReplyTextarea($widget);
      
      if ($ta.length) {
        insertAtCursor($ta[0], txt);
        $dialog.dialog('close');
        mw.notify('تم إضافة القالب بنجاح', { type: 'success' });
      } else {
        trySwitchToSource($widget);
        
        setTimeout(() => {
          $ta = findReplyTextarea($widget);
          
          if ($ta.length) {
            insertAtCursor($ta[0], txt);
            $dialog.dialog('close');
            mw.notify('تم إضافة القالب بنجاح', { type: 'success' });
          } else {
            
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(txt).then(() => {
                $dialog.dialog('close');
                mw.notify('تم نسخ النص إلى الحافظة. الصقه يدوياً في حقل الرد (Ctrl+V)', { type: 'success', autoHide: false });
              }).catch(() => {
                mw.notify('لا يمكن إدراج الرد. حاول مرة أخرى.', { type: 'warn' });
              });
            } else {
              mw.notify('لا يمكن إدراج الرد. حاول مرة أخرى.', { type: 'warn' });
            }
          }
        }, 300);
      }
    });
    
    $dialog.on('input', '#qr-search-box', function() {
      const searchTerm = $(this).val().toLowerCase().trim();
      
      $('.qr-reply-item').each(function() {
        const idx = Number($(this).data('idx'));
        const reply = QUICK_REPLIES[idx];
        const matchLabel = reply.label.toLowerCase().indexOf(searchTerm) !== -1;
        const matchText = reply.text.toLowerCase().indexOf(searchTerm) !== -1;
        
        if (searchTerm === '' || matchLabel || matchText) {
          $(this).show();
        } else {
          $(this).hide();
        }
      });
    });
    
    $dialog.dialog({
      title: '📋 الردود السريعة',
      width: 600,
      modal: true,
      buttons: [{
        text: 'إغلاق',
        click: function() {
          $(this).dialog('close');
        }
      }],
      open: function() {
        $('#qr-search-box').focus();
      }
    });
  }

  function buildSelect($widget, retry) {
    try {
      const $toolbar = $widget.find(SELECTORS.TOOLBAR).first();
      if (!$toolbar.length) {
        const r = retry || 0;
        if (r < 25) {
          setTimeout(() => buildSelect($widget, r + 1), 100);
        }
        return;
      }

      if ($toolbar.find('.qr-quickreplies-btn').length) {
        return;
      }


      const $host = $toolbar.find('.oo-ui-toolbar-actions').first();
      const $target = $host.length ? $host : $toolbar;

      const $wrap = $('<span>')
        .css({ 
          display: 'inline-flex', 
          alignItems: 'center', 
          gap: '5px', 
          marginInlineStart: CONFIG.SELECT_MARGIN,
          position: 'relative',
          zIndex: '10'
        });

      const $selectBtn = $('<button>')
        .addClass('qr-quickreplies-btn')
        .attr({ type: 'button', 'aria-label': 'اختر رداً سريعاً', title: 'ردود سريعة جاهزة' })
        .text('📋 ردود سريعة')
        .css({ 
          height: CONFIG.SELECT_HEIGHT,
          padding: '0 12px',
          fontSize: '13px',
          border: '1px solid #a2a9b1',
          borderRadius: '2px',
          backgroundColor: '#fff',
          cursor: 'pointer',
          fontWeight: '500',
          color: '#202122'
        })
        .on('click', function(e) {
          e.preventDefault();
          openQuickRepliesDialog($widget);
        });


      const $manageBtn = $('<button>')
        .attr({ type: 'button', title: 'إدارة الردود المخصصة', 'aria-label': 'إدارة الردود المخصصة' })
        .text('⚙️')
        .css({
          height: CONFIG.SELECT_HEIGHT,
          padding: '0 10px',
          cursor: 'pointer',
          border: '1px solid #a2a9b1',
          background: '#f8f9fa',
          borderRadius: '2px'
        })
        .on('click', function (e) { e.preventDefault(); openTemplateManager(); });

      $wrap.append($selectBtn, $manageBtn);
      $target.append($wrap);
    } catch (error) {
    }
  }

  function processExistingWidgets() {
    try {
      const $widgets = $(SELECTORS.REPLY_WIDGET);
      $widgets.each(function () {
        buildSelect($(this));
      });
    } catch (error) {
    }
  }

  async function initObserver() {
    try {
      await refreshReplies();
      
      processExistingWidgets();

      const debouncedHandler = debounce((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;

            const $node = $(node);
            
            if ($node.is(SELECTORS.TOOLBAR) || $node.find(SELECTORS.TOOLBAR).length) {
              const $w = $node.closest(SELECTORS.REPLY_WIDGET);
              if ($w.length) {
                buildSelect($w);
              }
            }
            
            const isWidget = $node.is(SELECTORS.REPLY_WIDGET);
            const foundWidgets = $node.find(SELECTORS.REPLY_WIDGET);
            
            
            if (isWidget || foundWidgets.length > 0) {
            }
            
            const $widgets = isWidget ? $node : foundWidgets;

            $widgets.each(function () {
              buildSelect($(this));
            });
          }
        }
      }, CONFIG.DEBOUNCE_DELAY);

      const observer = new MutationObserver(debouncedHandler);
      const root = document.querySelector('#mw-content-text') || document.body;
      observer.observe(root, {
        childList: true,
        subtree: true
      });
      
      let lastWidgetCount = 0;
      setInterval(() => {
        const $widgets = $(SELECTORS.REPLY_WIDGET);
        if ($widgets.length > lastWidgetCount) {
          $widgets.slice(lastWidgetCount).each(function() {
            buildSelect($(this));
          });
          lastWidgetCount = $widgets.length;
        } else if ($widgets.length < lastWidgetCount) {
          lastWidgetCount = $widgets.length;
        }
      }, 500);
    } catch (error) {
    }
  }

  var modulesToLoad = ['mediawiki.api', 'oojs-ui-core', 'oojs-ui-widgets', 'jquery.ui'];
  
  mw.loader.using(modulesToLoad).then(
    function() {
      return initObserver();
    },
    function() {
      // Ignore module loading errors
    }
  ).then(
    function() {
      // Initialization complete
    },
    function() {
      // Ignore initialization errors
    }
  );
})();
