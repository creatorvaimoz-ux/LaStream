const fs = require('fs');
const path = require('path');

module.exports = function() {
    const filePath = path.join(__dirname, '..', 'views', 'rotations.ejs');
    let content = fs.readFileSync(filePath, 'utf8');
    
    // We want to extract the table/list (lines 34 to 326 approximately)
    // The list starts with: <% if (rotations && rotations.length > 0) { %>
    // And ends right before: <div id="createRotationModal" class="fixed inset-0 bg-black/50 z-50 hidden modal-overlay overflow-y-auto">
    
    const tableStartMarker = '<% if (rotations && rotations.length > 0) { %>';
    const modalStartMarker = '<div id="createRotationModal"';
    
    const tableStartIndex = content.indexOf(tableStartMarker);
    const modalStartIndex = content.indexOf(modalStartMarker);
    
    if (tableStartIndex === -1 || modalStartIndex === -1) {
        throw new Error('Markers not found in rotations.ejs');
    }
    
    // The header is everything before the table
    let headerStr = content.substring(0, tableStartIndex);
    
    // The table is everything from tableStartMarker up to modalStartMarker
    let tableStr = content.substring(tableStartIndex, modalStartIndex);
    
    // Clean up the tableStr to remove closing tags that belong to the else block
    // Wait, the table block ends with <% } %> right before the modal.
    
    // Now let's extract the modal content
    const formStartMarker = '<form id="rotationForm" class="space-y-6">';
    const formEndMarker = '</form>';
    
    const formStartIndex = content.indexOf(formStartMarker);
    const formEndIndex = content.indexOf(formEndMarker, formStartIndex) + formEndMarker.length;
    
    let originalFormStr = content.substring(formStartIndex, formEndIndex);
    
    // We will completely replace originalFormStr with our NEW Grid layout
    // We don't need to parse the inner inputs because we'll just inject them
    // Wait, actually I will just write out the NEW FORM string in Javascript, injecting the existing inner pieces where necessary.
    // Or even simpler: Just define the NEW FORM string from scratch! It's static HTML!
    
    const newFormHtml = `
<!-- MAIN FORM (Always visible) -->
<form id="rotationForm" class="space-y-6">
  <input type="hidden" id="rotationId" name="rotationId" value="">
  
  <div class="grid grid-cols-1 lg:grid-cols-5 gap-3 sm:gap-5" id="LiveTaskFormGrid">
    
    <!-- ========== LEFT COLUMN ========== -->
    <div class="lg:col-span-3 space-y-3 sm:space-y-5">
      <!-- StreamGeneralSettingsCard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-settings text-primary"></i> 1. Pengaturan Stream Umum
            </h3>
         </div>
         <div class="p-5 space-y-4">
            <div>
              <label class="text-sm font-medium text-slate-800 block mb-2">Nama Tugas Live (Rotation Name)</label>
              <input type="text" id="rotationName" name="rotationName" class="w-full px-4 py-2.5 bg-slate-100 border border-slate-300 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary" placeholder="Contoh: Lo-fi Jazz Stream" required>
            </div>
         </div>
      </div>
      
      <!-- YouTubeMetadataCard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-brand-youtube text-red-500"></i> 2. Metadata YouTube Studio
            </h3>
         </div>
         <div class="p-5 space-y-4">
            <div>
              <label class="text-sm font-medium text-slate-800 block mb-2">Pilih Channel YouTube</label>
              <div class="relative" id="rotationChannelSelector">
                <button type="button" onclick="toggleRotationChannelDropdown()" class="w-full flex items-center gap-3 px-3 py-2.5 bg-slate-100 border border-slate-300 rounded-lg hover:border-slate-300 focus:border-primary focus:ring-1 focus:ring-primary transition-colors text-left">
                  <img id="rotationChannelThumb" src="<%= typeof youtubeChannels !== 'undefined' && youtubeChannels.length > 0 ? (youtubeChannels.find(c => c.is_default) || youtubeChannels[0]).channel_thumbnail : '' %>" alt="" class="w-6 h-6 rounded-full object-cover flex-shrink-0" onerror="this.src='/images/default-avatar.jpg'">
                  <span id="rotationChannelName" class="flex-1 text-sm text-slate-800 truncate"><%= typeof youtubeChannels !== 'undefined' && youtubeChannels.length > 0 ? (youtubeChannels.find(c => c.is_default) || youtubeChannels[0]).channel_name : 'Select Channel' %></span>
                  <i class="ti ti-chevron-down text-slate-500 flex-shrink-0"></i>
                </button>
                <div id="rotationChannelDropdown" class="hidden absolute z-30 mt-1 w-full bg-slate-100 border border-slate-300 rounded-lg shadow-lg overflow-hidden">
                  <% if (typeof youtubeChannels !== 'undefined' && youtubeChannels.length > 0) { %>
                    <% youtubeChannels.forEach(function(channel) { %>
                    <button type="button" onclick="selectRotationChannel('<%= channel.id %>', '<%= channel.channel_name %>', '<%= channel.channel_thumbnail %>')" class="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-200 text-left rotation-channel-option" data-channel-id="<%= channel.id %>">
                      <img src="<%= channel.channel_thumbnail %>" alt="" class="w-6 h-6 rounded-full object-cover flex-shrink-0" onerror="this.src='/images/default-channel.png'">
                      <span class="text-sm text-slate-800 truncate"><%= channel.channel_name %></span>
                    </button>
                    <% }); %>
                  <% } %>
                </div>
                <input type="hidden" id="rotationChannelId" name="rotationChannelId" value="<%= typeof youtubeChannels !== 'undefined' && youtubeChannels.length > 0 ? (youtubeChannels.find(c => c.is_default) || youtubeChannels[0]).id : '' %>">
              </div>
            </div>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium text-slate-800 block mb-2">Privasi Global</label>
                <select id="globalPrivacy" name="globalPrivacy" class="w-full px-4 py-2.5 bg-slate-100 border border-slate-300 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary">
                  <option value="public">Public</option>
                  <option value="unlisted" selected>Unlisted</option>
                  <option value="private">Private</option>
                </select>
              </div>
              <div>
                <label class="text-sm font-medium text-slate-800 block mb-2">Kategori Global</label>
                <select id="globalCategory" name="globalCategory" class="w-full px-4 py-2.5 bg-slate-100 border border-slate-300 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary">
                  <option value="22">People & Blogs</option>
                  <option value="20">Gaming</option>
                  <option value="24">Entertainment</option>
                  <option value="10">Music</option>
                  <option value="28">Science & Technology</option>
                  <option value="17">Sports</option>
                  <option value="27">Education</option>
                </select>
              </div>
            </div>
         </div>
      </div>
      
      <!-- VodAfterLiveCard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-video text-indigo-500"></i> VOD After Live
            </h3>
         </div>
         <div class="p-5">
            <p class="text-sm text-slate-500">Pengaturan VOD setelah stream selesai akan ditambahkan di update berikutnya.</p>
         </div>
      </div>
    </div>
    
    <!-- ========== RIGHT COLUMN ========== -->
    <div class="lg:col-span-2 space-y-3 sm:space-y-5">
      <!-- ThumbnailSettingsCard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-photo text-teal-500"></i> Pengaturan Thumbnail
            </h3>
         </div>
         <div class="p-5">
             <p class="text-xs text-slate-500">Thumbnail dapat diatur pada masing-masing item video di bagian bawah.</p>
         </div>
      </div>
      
      <!-- SchedulePublishCard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-calendar-time text-orange-500"></i> Atur Penjadwal & Publish
            </h3>
         </div>
         <div class="p-5 space-y-4">
            <div class="flex items-center gap-2 mb-2">
              <span id="rotationServerTime" class="bg-slate-100 text-xs text-slate-600 px-2 py-0.5 rounded border border-slate-200">Server time: loading...</span>
            </div>
            <div>
              <label class="text-sm font-medium text-slate-800 block mb-2">Mode Pengulangan</label>
              <select id="repeatMode" name="repeatMode" class="w-full px-4 py-2.5 bg-slate-100 border border-slate-300 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary">
                <option value="daily" selected>Setiap Hari</option>
                <option value="weekly">Setiap Minggu</option>
                <option value="monthly">Setiap Bulan</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium text-slate-800 block mb-2">Waktu Mulai</label>
                <input type="time" id="rotationStartTime" name="rotationStartTime" class="w-full px-4 py-2.5 bg-slate-100 border border-slate-300 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary [color-scheme:dark]" required>
              </div>
              <div>
                <label class="text-sm font-medium text-slate-800 block mb-2">Waktu Selesai</label>
                <input type="time" id="rotationEndTime" name="rotationEndTime" class="w-full px-4 py-2.5 bg-slate-100 border border-slate-300 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary [color-scheme:dark]" required>
              </div>
            </div>
            <div>
               <span id="rotationDurationBadge" class="bg-sky-50 text-sky-700 border border-sky-200 text-xs font-semibold px-2.5 py-1 rounded">Durasi: 00:00</span>
            </div>
         </div>
      </div>
      
      <!-- ContentAICard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-violet-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-sparkles text-violet-500"></i> Content AI Generator
            </h3>
         </div>
         <div class="p-5">
            <p class="text-xs text-slate-500">Generator AI tersedia di setiap pengaturan item video.</p>
         </div>
      </div>
      
      <!-- MonetizationCard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-green-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-currency-dollar text-green-500"></i> Monetisasi
            </h3>
         </div>
         <div class="p-5">
            <div class="h-[42px] px-4 bg-slate-100 border border-slate-300 rounded-lg flex items-center justify-between">
              <span class="text-sm text-slate-600">Aktifkan Monetisasi</span>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="globalMonetization" name="globalMonetization" class="sr-only peer">
                <div class="w-11 h-6 bg-slate-50 rounded-full peer peer-checked:bg-primary border border-slate-200"></div>
                <div class="absolute left-[2px] top-[2px] w-5 h-5 bg-white rounded-full transition-all peer-checked:translate-x-5 shadow"></div>
              </label>
            </div>
         </div>
      </div>
      
      <!-- OverlayWatermarkCard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-layers-intersect text-pink-500"></i> Dynamic Overlays & Watermark
            </h3>
         </div>
         <div class="p-5">
            <p class="text-xs text-slate-500">Fitur kustom watermark akan segera hadir.</p>
         </div>
      </div>
      
      <!-- TranscoderOutputCard -->
      <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div class="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50">
            <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
               <i class="ti ti-cpu text-blue-500"></i> Transkoder & Output
            </h3>
         </div>
         <div class="p-5">
            <p class="text-xs text-slate-500">Pengaturan resolusi hardware akan segera hadir.</p>
         </div>
      </div>
    </div>
  </div>
  
  <!-- SchedulerPreviewCard -->
  <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-6">
    <div class="px-5 py-4 border-b border-slate-200/60 bg-slate-50/50 flex justify-between items-center">
      <h3 class="text-sm font-semibold text-slate-800 flex items-center gap-2">
         <i class="ti ti-list-details text-primary"></i> Daftar Video / Item Rotasi
      </h3>
    </div>
    <div class="p-5">
       <div id="rotationItemsContainer" class="space-y-4"></div>
       <button type="button" onclick="addRotationItem()" class="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 border-2 border-dashed border-slate-300 hover:border-slate-400 text-slate-600 hover:text-slate-900 rounded-lg transition-colors font-medium">
         <i class="ti ti-plus"></i> Tambah Item Video
       </button>
    </div>
  </div>
</form>

<!-- BOTTOM ACTION BAR -->
<div class="fixed bottom-0 left-0 lg:left-64 right-0 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-40 p-4 flex justify-end gap-3 transition-all duration-300" id="bottomActionBar">
   <button type="button" onclick="resetForm()" class="px-5 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">Batal / Reset</button>
   <button type="button" onclick="saveRotation()" id="saveRotationBtn" class="px-6 py-2.5 text-sm font-medium bg-primary hover:bg-sky-700 text-white rounded-lg transition-colors shadow-sm flex items-center gap-2">
      <i class="ti ti-device-floppy"></i> Simpan Tugas Live
   </button>
</div>

<!-- LIVE SCHEDULE LIST CARD -->
<div class="mt-8 mb-24" id="liveScheduleListSection">
   <h2 class="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
     <i class="ti ti-history text-slate-500"></i> Daftar Tugas Live Tersimpan
   </h2>
`;

    const remainingHtml = `
</div>
`;

    // Now we piece it together!
    // headerStr is lines 1 to 33. We should remove the "New Rotation" button from headerStr.
    headerStr = headerStr.replace(/<button onclick="openCreateRotationModal[^>]*>[\s\S]*?<\/button>/, '');
    
    // We assemble the new file:
    // Header -> New Form Html -> Table List -> Remaining Html -> Then we append the scripts that were originally AFTER the form.
    // The original form ended at formEndIndex.
    // Wait, the original modal ended at a few </div> tags after the form.
    
    const logsModalStart = content.indexOf('<!-- Logs Modal -->');
    const scriptsStr = content.substring(logsModalStart);
    
    const finalContent = headerStr + newFormHtml + tableStr + remainingHtml + scriptsStr;
    
    // Write it back
    fs.writeFileSync(filePath, finalContent, 'utf8');
};
