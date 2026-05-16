const fs = require('fs');
const path = require('path');

const ejsPath = path.join(__dirname, '../views/rotations.ejs');
const content = fs.readFileSync(ejsPath, 'utf8');

const scriptStart = content.indexOf('<script>');
if (scriptStart === -1) {
  console.log("Could not find <script> tag");
  process.exit(1);
}

const beforeScript = content.substring(0, scriptStart);

const newScript = `
<script>
const videos = <%- JSON.stringify(typeof videos !== 'undefined' ? videos : []) %>;
const playlists = <%- JSON.stringify(typeof playlists !== 'undefined' ? playlists : []) %>;
const csrfToken = '<%= csrfToken %>';

// populate video multi-select
const globalVideos = document.getElementById('globalVideos');
if (globalVideos) {
  videos.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.title;
    globalVideos.appendChild(opt);
  });
  playlists.forEach(p => {
    const opt = document.createElement('option');
    opt.value = 'playlist:' + p.id;
    opt.textContent = '[Playlist] ' + p.name;
    globalVideos.appendChild(opt);
  });
}

function updateRotationServerTime() {
  fetch('/api/server-time')
    .then(response => response.json())
    .then(data => {
      const serverTimeEl = document.getElementById('rotationServerTime');
      if (serverTimeEl && data.formattedTime) {
        serverTimeEl.textContent = \`Server time: \${data.formattedTime}\`;
      }
    })
    .catch(error => console.error('Error fetching server time:', error));
}

updateRotationServerTime();
setInterval(updateRotationServerTime, 1000);

function calculateDuration() {
  const startTime = document.getElementById('rotationStartTime').value;
  const endTime = document.getElementById('rotationEndTime').value;
  const badge = document.getElementById('rotationDurationBadge');
  
  if (!startTime || !endTime) {
    badge.textContent = 'Durasi: 00:00';
    return;
  }

  const start = new Date(\`2000-01-01T\${startTime}:00\`);
  let end = new Date(\`2000-01-01T\${endTime}:00\`);
  
  if (end < start) {
    end.setDate(end.getDate() + 1);
  }
  
  const diffMs = end - start;
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffMins = Math.floor((diffMs % 3600000) / 60000);
  
  badge.textContent = \`Durasi: \${String(diffHrs).padStart(2, '0')}:\${String(diffMins).padStart(2, '0')}\`;
}

document.getElementById('rotationStartTime').addEventListener('input', calculateDuration);
document.getElementById('rotationEndTime').addEventListener('input', calculateDuration);

function showToast(type, message) {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const msg = document.getElementById('toast-message');
  
  toast.className = \`fixed top-16 right-4 px-4 py-3 rounded-lg shadow-lg z-50 flex items-center border-l-4 transition-opacity duration-300 \${
    type === 'success' ? 'bg-white border-green-500 text-slate-800' : 'bg-white border-red-500 text-slate-800'
  }\`;
  
  icon.className = type === 'success' ? 'ti ti-check text-green-500 mr-2 text-lg' : 'ti ti-alert-circle text-red-500 mr-2 text-lg';
  msg.textContent = message;
  
  toast.classList.remove('hidden');
  
  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('opacity-0');
    }, 300);
  }, 3000);
}

function toggleRotationChannelDropdown() {
  const dropdown = document.getElementById('rotationChannelDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

function selectRotationChannel(channelId, channelName, channelThumbnail) {
  document.getElementById('rotationChannelId').value = channelId;
  document.getElementById('rotationChannelThumb').src = channelThumbnail;
  document.getElementById('rotationChannelName').textContent = channelName;
  toggleRotationChannelDropdown();
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#rotationChannelSelector')) {
    const dropdown = document.getElementById('rotationChannelDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }
});

function resetForm() {
  document.getElementById('rotationForm').reset();
  document.getElementById('rotationId').value = '';
  const videoSelect = document.getElementById('globalVideos');
  if (videoSelect) {
    Array.from(videoSelect.options).forEach(opt => opt.selected = false);
  }
  document.getElementById('globalMonetization').checked = false;
  document.getElementById('repeatMode').value = 'daily';
  
  const preview = document.getElementById('globalThumbnailPreview');
  if (preview) {
    preview.src = '';
    preview.parentElement.classList.add('hidden');
    preview.parentElement.previousElementSibling.classList.remove('hidden');
    document.getElementById('globalThumbnail').dataset.existingPath = '';
    document.getElementById('globalThumbnail').dataset.originalPath = '';
  }
  
  const channelSelectorBtn = document.querySelector('#rotationChannelSelector > button');
  if (channelSelectorBtn) {
    channelSelectorBtn.disabled = false;
    channelSelectorBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    channelSelectorBtn.onclick = toggleRotationChannelDropdown;
    channelSelectorBtn.title = '';
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function compressRotationThumbnail(file) {
  if (!file || !file.type.startsWith('image/')) {
    return file;
  }

  try {
    const imageUrl = URL.createObjectURL(file);
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });

    const MAX_WIDTH = 1280;
    const MAX_HEIGHT = 720;
    let width = image.width;
    let height = image.height;

    if (width > MAX_WIDTH || height > MAX_HEIGHT) {
      if (width / height > MAX_WIDTH / MAX_HEIGHT) {
        width = MAX_WIDTH;
        height = Math.round(MAX_WIDTH * (image.height / image.width));
      } else {
        height = MAX_HEIGHT;
        width = Math.round(MAX_HEIGHT * (image.width / image.height));
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);

    const compressedBlob = await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 0.85);
    });

    URL.revokeObjectURL(imageUrl);
    return new File([compressedBlob], file.name.replace(/\\.[^/.]+$/, "") + ".jpg", {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch (error) {
    console.error('Error compressing thumbnail:', error);
    return file;
  }
}

// Global Thumbnail preview handler
const globalThumbnailInput = document.getElementById('globalThumbnail');
if (globalThumbnailInput) {
  globalThumbnailInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const preview = document.getElementById('globalThumbnailPreview');
        preview.src = ev.target.result;
        preview.parentElement.classList.remove('hidden');
        preview.parentElement.previousElementSibling.classList.add('hidden');
        globalThumbnailInput.dataset.existingPath = '';
        globalThumbnailInput.dataset.originalPath = '';
      };
      reader.readAsDataURL(file);
    }
  });
}

async function saveRotation() {
  const rotationId = document.getElementById('rotationId').value;
  const name = document.getElementById('rotationName').value;
  
  // Get multiple videos
  const globalVideosEl = document.getElementById('globalVideos');
  const selectedVideoIds = Array.from(globalVideosEl.selectedOptions).map(opt => opt.value);
  
  if (!name) {
    showToast('error', 'Please enter rotation name');
    return;
  }
  if (selectedVideoIds.length === 0) {
    showToast('error', 'Please select at least one video');
    return;
  }
  
  const repeatMode = document.getElementById('repeatMode').value;
  const startTime = document.getElementById('rotationStartTime').value;
  const endTime = document.getElementById('rotationEndTime').value;
  
  if (!startTime || !endTime) {
    showToast('error', 'Please set start and end time');
    return;
  }
  
  const saveBtn = document.getElementById('saveRotationBtn');
  if(saveBtn){
    const originalBtnText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="ti ti-loader animate-spin font-loaded"></i> Saving...';
    saveBtn.disabled = true;
    saveBtn.classList.add('opacity-70', 'cursor-not-allowed');
    window._resetSaveBtn = function() {
      saveBtn.innerHTML = originalBtnText;
      saveBtn.disabled = false;
      saveBtn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
  } else {
    window._resetSaveBtn = function() {}
  }
  
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  // Check custom start/end dates
  const startDateInput = document.getElementById('rotationStartDate').value;
  const endDateInput = document.getElementById('rotationEndDate').value;
  
  const startDay = startDateInput || \`\${year}-\${month}-\${day}\`;
  const endDay = endDateInput || startDay;

  const startDateTime = new Date(\`\${startDay}T\${startTime}:00\`);
  const endDateTime = new Date(\`\${endDay}T\${endTime}:00\`);
  
  const formatLocalDateTime = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return \`\${y}-\${m}-\${d}T\${h}:\${min}:\${s}\`;
  };
  
  const startDateTimeStr = formatLocalDateTime(startDateTime);
  const endDateTimeStr = formatLocalDateTime(endDateTime);
  
  // Global Metadata
  const globalPrivacy = document.getElementById('globalPrivacy').value;
  const globalCategory = document.getElementById('globalCategory').value;
  const globalMonetization = document.getElementById('globalMonetization').checked;
  const globalClosedCaptions = document.getElementById('globalClosedCaptions').checked;
  const globalTags = document.getElementById('globalTags').value;
  const globalDescription = document.getElementById('globalDescription').value;
  
  // Global Titles (one per line)
  const titlesRaw = document.getElementById('globalTitles').value;
  const titlesArray = titlesRaw.split('\\n').map(t => t.trim()).filter(t => t);
  
  const items = [];
  const formData = new FormData();
  
  for (let i = 0; i < selectedVideoIds.length; i++) {
    const videoId = selectedVideoIds[i];
    
    let title_alternatives = titlesArray.length > 1 ? titlesArray : null;
    let title = titlesArray.length > 0 ? titlesArray[Math.floor(Math.random() * titlesArray.length)] : (name + ' #' + (i+1));
    
    // thumbnail logic
    let thumbnailPath = null;
    let originalThumbnailPath = null;
    if (rotationId && globalThumbnailInput && globalThumbnailInput.dataset.existingPath) {
      thumbnailPath = globalThumbnailInput.dataset.existingPath;
      originalThumbnailPath = globalThumbnailInput.dataset.originalPath || null;
    }

    items.push({
      order_index: i,
      video_id: videoId,
      title: title,
      description: globalDescription,
      privacy: globalPrivacy,
      category: globalCategory,
      youtube_monetization: globalMonetization,
      youtube_closed_captions: globalClosedCaptions,
      tags: globalTags,
      thumbnail_upload_index: i === 0 ? 0 : -1, // Use first thumbnail for all?
      thumbnail_path: thumbnailPath,
      original_thumbnail_path: originalThumbnailPath,
      title_alternatives: title_alternatives
    });
  }
  
  if (globalThumbnailInput && globalThumbnailInput.files && globalThumbnailInput.files[0]) {
    const compressedThumbnail = await compressRotationThumbnail(globalThumbnailInput.files[0]);
    formData.append('thumbnail_0', compressedThumbnail, compressedThumbnail.name);
  }
  
  const youtubeChannelId = document.getElementById('rotationChannelId').value;
  
  formData.append('name', name);
  formData.append('repeat_mode', repeatMode);
  formData.append('start_time', startDateTimeStr);
  formData.append('end_time', endDateTimeStr);
  formData.append('youtube_channel_id', youtubeChannelId);
  formData.append('items', JSON.stringify(items));
  
  try {
    const url = rotationId ? \`/api/rotations/\${rotationId}\` : '/api/rotations';
    const method = rotationId ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: {
        'X-CSRF-Token': csrfToken
      },
      body: formData
    });

    let result;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      result = await response.json();
    } else {
      const errorText = await response.text();
      result = {
        success: false,
        error: response.status === 413
          ? 'Thumbnail upload is too large. Please use smaller images.'
          : (errorText || \`Request failed with status \${response.status}\`)
      };
    }
    
    if (response.ok && result.success) {
      showToast('success', rotationId ? 'Rotation updated!' : 'Rotation created!');
      setTimeout(() => window.location.reload(), 1000);
    } else {
      showToast('error', result.error || 'Failed to save rotation');
      window._resetSaveBtn();
    }
  } catch (error) {
    console.error('Error:', error);
    showToast('error', 'An error occurred');
    window._resetSaveBtn();
  }
}

async function editRotation(id) {
  try {
    const response = await fetch(\`/api/rotations/\${id}\`);
    const result = await response.json();
    
    if (result.success) {
      const rotation = result.rotation;
      
      document.getElementById('rotationId').value = rotation.id;
      document.getElementById('rotationName').value = rotation.name;
      document.getElementById('repeatMode').value = rotation.repeat_mode || 'daily';
      
      if (rotation.start_time) {
        const d = new Date(rotation.start_time);
        document.getElementById('rotationStartTime').value = d.toTimeString().slice(0, 5);
        document.getElementById('rotationStartDate').value = d.toISOString().split('T')[0];
      }
      if (rotation.end_time) {
        const d = new Date(rotation.end_time);
        document.getElementById('rotationEndTime').value = d.toTimeString().slice(0, 5);
        document.getElementById('rotationEndDate').value = d.toISOString().split('T')[0];
      }
      
      calculateDuration();
      
      const videoSelect = document.getElementById('globalVideos');
      Array.from(videoSelect.options).forEach(opt => opt.selected = false);
      
      let mainTitle = '';
      let titleAlts = [];
      
      if (rotation.items && rotation.items.length > 0) {
        const firstItem = rotation.items[0];
        document.getElementById('globalPrivacy').value = firstItem.privacy || 'unlisted';
        document.getElementById('globalCategory').value = firstItem.category || '22';
        document.getElementById('globalMonetization').checked = firstItem.youtube_monetization === true || firstItem.youtube_monetization === 1;
        document.getElementById('globalClosedCaptions').checked = firstItem.youtube_closed_captions === true || firstItem.youtube_closed_captions === 1;
        document.getElementById('globalDescription').value = firstItem.description || '';
        document.getElementById('globalTags').value = firstItem.tags || '';
        
        mainTitle = firstItem.title || '';
        if (Array.isArray(firstItem.title_alternatives)) {
          titleAlts = firstItem.title_alternatives;
        }
        
        // Select videos
        rotation.items.forEach(item => {
          const opt = Array.from(videoSelect.options).find(o => o.value === String(item.video_id));
          if (opt) opt.selected = true;
        });
        
        // Load thumbnail
        if (firstItem.thumbnail_path && firstItem.thumbnail_path !== 'rotations') {
          const preview = document.getElementById('globalThumbnailPreview');
          if (preview) {
            preview.src = \`/uploads/thumbnails/\${firstItem.thumbnail_path.split('/').pop()}\`;
            preview.parentElement.classList.remove('hidden');
            preview.parentElement.previousElementSibling.classList.add('hidden');
            
            document.getElementById('globalThumbnail').dataset.existingPath = firstItem.thumbnail_path;
            document.getElementById('globalThumbnail').dataset.originalPath = firstItem.original_thumbnail_path || '';
          }
        }
      } else {
        document.getElementById('globalMonetization').checked = false;
      }
      
      // Merge titles for textarea
      const allTitles = titleAlts.length > 0 ? titleAlts : [mainTitle];
      document.getElementById('globalTitles').value = allTitles.join('\\n');
      
      if (rotation.youtube_channel_id) {
        document.getElementById('rotationChannelId').value = rotation.youtube_channel_id;
        if (rotation.youtube_channel_name) {
          document.getElementById('rotationChannelName').textContent = rotation.youtube_channel_name;
        }
        if (rotation.youtube_channel_thumbnail) {
          document.getElementById('rotationChannelThumb').src = rotation.youtube_channel_thumbnail;
        }
      }
      
      const channelSelectorBtn = document.querySelector('#rotationChannelSelector > button');
      if (rotation.status === 'active') {
        channelSelectorBtn.disabled = true;
        channelSelectorBtn.classList.add('opacity-50', 'cursor-not-allowed');
        channelSelectorBtn.onclick = null;
        channelSelectorBtn.title = 'Cannot change channel while running';
      } else {
        channelSelectorBtn.disabled = false;
        channelSelectorBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        channelSelectorBtn.onclick = toggleRotationChannelDropdown;
        channelSelectorBtn.title = '';
      }
      
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      showToast('error', 'Failed to load rotation');
    }
  } catch (error) {
    console.error('Error:', error);
    showToast('error', 'An error occurred');
  }
}

async function deleteRotation(id) {
  if (!confirm('Are you sure you want to delete this rotation?')) {
    return;
  }
  
  try {
    const response = await fetch(\`/api/rotations/\${id}\`, {
      method: 'DELETE',
      headers: {
        'X-CSRF-Token': csrfToken
      }
    });
    const result = await response.json();
    
    if (result.success) {
      showToast('success', 'Rotation deleted successfully');
      setTimeout(() => window.location.reload(), 1000);
    } else {
      showToast('error', result.error || 'Failed to delete rotation');
    }
  } catch (error) {
    console.error('Error:', error);
    showToast('error', 'An error occurred');
  }
}

// Log Viewer Logic
window.viewRotationLogs = async function(id) {
  const modal = document.getElementById('rotationLogsModal');
  const container = document.getElementById('rotationLogsContainer');
  modal.classList.remove('hidden');
  container.innerHTML = '<div class="flex items-center justify-center py-12 text-slate-400"><i class="ti ti-loader animate-spin text-2xl"></i></div>';
  
  try {
    const res = await fetch(\`/api/rotations/\${id}/logs\`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    if (!data.logs || data.logs.length === 0) {
      container.innerHTML = \`
        <div class="flex flex-col items-center justify-center py-12 text-slate-400 text-sm">
          <i class="ti ti-file-info text-4xl mb-2 text-slate-300"></i>
          Belum ada log untuk rotasi ini.
        </div>\`;
      return;
    }

    container.innerHTML = \`<div class="space-y-3">\` + data.logs.map(log => {
      let icon = 'ti-info-circle text-blue-500 bg-blue-100';
      if (log.action === 'start') icon = 'ti-player-play text-green-500 bg-green-100';
      if (log.action === 'stop') icon = 'ti-player-stop text-amber-500 bg-amber-100';
      if (log.action === 'error') icon = 'ti-alert-circle text-red-500 bg-red-100';
      if (log.action === 'complete') icon = 'ti-check text-primary bg-sky-100';

      const d = new Date(log.created_at);
      const timeStr = d.toLocaleDateString('id-ID', { month:'short', day:'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

      return \`
        <div class="flex items-start gap-3 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
          <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 \${icon.split(' ')[2]}">
            <i class="ti \${icon.split(' ').slice(0,2).join(' ')}"></i>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-800 uppercase">\${log.action}</span>
              <span class="text-[10px] text-slate-400">\${timeStr}</span>
            </div>
            <p class="text-xs text-slate-600 mt-1">\${log.message}</p>
            \${log.duration_seconds ? \`<div class="text-[10px] text-slate-400 mt-1"><i class="ti ti-clock"></i> Durasi: \${log.duration_seconds}s</div>\` : ''}
          </div>
        </div>\`;
    }).join('') + \`</div>\`;

  } catch(e) {
    container.innerHTML = \`<div class="p-4 text-center text-red-500 text-sm">Gagal memuat logs: \${e.message}</div>\`;
  }
};
</script>
`;

fs.writeFileSync(ejsPath, beforeScript + newScript);
console.log("Successfully replaced script in rotations.ejs");
