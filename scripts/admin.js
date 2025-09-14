// sih_250_main (1)/scripts/admin.js

// ====================================================
// SUPABASE & API CONFIGURATION
// ====================================================
const SUPABASE_URL = 'https://samikiantytgcxlbtqnp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhbWlraWFudHl0Z2N4bGJ0cW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0MTU2NTMsImV4cCI6MjA3Mjk5MTY1M30.VDbliaiLO0km0UAAnJe0fejYHHVVgc5c_DCBrePW29I';
const FACE_API_URL = 'http://localhost:5000'; // Use the Vercel API route

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global variables
let classAttendanceChart = null;
let editingStudentId = null;
let schoolId = null;


// ====================================================
// INITIALIZATION
// ====================================================
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.href = '/login.html';
    return;
  }
  
  initializePage();

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await db.auth.signOut();
    window.location.href = '/login.html';
  });
});

async function initializePage() {
    const { data: { user } } = await db.auth.getUser();
    const { data: schoolData, error: schoolError } = await db.from('schools').select('id, name').eq('user_id', user.id).single();
    if (schoolError || !schoolData) {
        showNotification('Error: Could not identify your school. Please contact support.', 'error');
        return;
    }
    schoolId = schoolData.id;
    document.getElementById('school-name-display').textContent = schoolData.name;

    const datePicker = document.getElementById('attendance-date-picker');
    datePicker.value = new Date().toISOString().split('T')[0];
    
    // Attach all event listeners
    datePicker.addEventListener('change', loadAttendanceData);
    document.getElementById('student-search').addEventListener('keyup', renderStudentsTable);
    document.getElementById('student-form').addEventListener('submit', saveStudent);
    document.getElementById('add-class-form').addEventListener('submit', addClass);
    document.getElementById('add-section-form').addEventListener('submit', addSection);
    document.getElementById('holiday-form').addEventListener('submit', handleHolidayForm);
    document.getElementById('settings-form').addEventListener('submit', handleGeneralSettingsForm);
    document.getElementById('whatsapp-settings-form').addEventListener('submit', handleWhatsappSettingsForm);
    document.getElementById('manual-alert-btn').addEventListener('click', sendLowAttendanceAlerts);
    document.getElementById('whatsapp-enabled').addEventListener('change', toggleWhatsappControls);
    
    // Attendance filter listeners
    const attendanceClassEl = document.getElementById('attendance-class');
    attendanceClassEl.addEventListener('change', async (e) => {
        await updateAttendanceSectionOptions(e.target.value);
        loadAttendanceData(); // Load data for "All Sections" by default
    });
    document.getElementById('attendance-section').addEventListener('change', loadAttendanceData);


    // Load initial school-specific data
    await updateClassSelectors();
    await renderStudentsTable(); 
    await loadDashboardMetrics();
    await loadHolidays();
    await loadSettings();
    await renderClassesList();
    await renderSectionsList();
    
    showTab('dashboard'); 
}

// ====================================================
// UI INTERACTIVITY
// ====================================================

function toggleWhatsappControls() {
    const isEnabled = document.getElementById('whatsapp-enabled').checked;
    const controlsContainer = document.getElementById('whatsapp-controls-container');

    // Toggle opacity for visual feedback
    controlsContainer.style.opacity = isEnabled ? '1' : '0.5';
    
    // Get all buttons and inputs within the container
    const inputs = controlsContainer.querySelectorAll('input, button');
    
    inputs.forEach(input => {
        input.disabled = !isEnabled;
    });
}


// ====================================================
// UTILITY & TAB MANAGEMENT
// ====================================================
function showNotification(message, type = 'success') {
  const container = document.getElementById('notification-container');
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  container.appendChild(notification);
  setTimeout(() => notification.classList.add('show'), 100);
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 3000);
  }, 3000);
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function showTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('tab-active');
    btn.classList.add('text-gray-600');
  });
  
  const content = document.getElementById(`content-${tabName}`);
  const tab = document.getElementById(`tab-${tabName}`);
  
  if (content) content.classList.remove('hidden');
  if (tab) {
    tab.classList.add('tab-active');
    tab.classList.remove('text-gray-600');
  }
}

// ====================================================
// DASHBOARD METRICS
// ====================================================
async function loadDashboardMetrics() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: schoolStudents, error: schoolStudentsError } = await db.from('students').select('id').eq('school_id', schoolId);
    if (schoolStudentsError) {
        console.error("Error fetching students for dashboard", schoolStudentsError);
        return;
    }
    
    const studentIdsForSchool = schoolStudents.map(s => s.id);
    const studentsCount = studentIdsForSchool.length;
    document.getElementById('metric-total-students').textContent = studentsCount;

    if (studentsCount === 0) {
        document.getElementById('metric-overall-attendance').textContent = 'N/A';
        document.getElementById('metric-today-attendance').textContent = 'N/A';
        return;
    }

    const [
        { data: recentAttendance, error: overallError },
        { data: sectionData, error: sectionError }
    ] = await Promise.all([
        db.from('attendance').select('student_id, status, date').gte('date', thirtyDaysAgoStr).in('student_id', studentIdsForSchool),
        db.from('sections').select(`name, classes!inner(name), students!inner(id)`).eq('classes.school_id', schoolId)
    ]);
    
    if (overallError || sectionError) {
        console.error("Error fetching dashboard data", overallError || sectionError);
        return;
    }

    // --- Calculate and Display Simple Metrics ---
    if (recentAttendance && recentAttendance.length > 0) {
        const presentOrLate = recentAttendance.filter(r => r.status === 'present' || r.status === 'late').length;
        const rate = Math.round((presentOrLate / recentAttendance.length) * 100);
        document.getElementById('metric-overall-attendance').textContent = `${rate}%`;
    } else {
        document.getElementById('metric-overall-attendance').textContent = 'N/A';
    }

    const todayAttd = recentAttendance ? recentAttendance.filter(r => r.date === todayStr) : [];
    const presentOrLateToday = todayAttd.filter(r => r.status === 'present' || r.status === 'late').length;
    const rateToday = Math.round((presentOrLateToday / studentsCount) * 100);
    document.getElementById('metric-today-attendance').textContent = `${rateToday}%`;

    // --- Top Present & Absentees Lists ---
    const topAbsenteesList = document.getElementById('metric-top-absentees');
    const topPresentList = document.getElementById('metric-top-present');
    topAbsenteesList.innerHTML = '';
    topPresentList.innerHTML = '';
    
    if (recentAttendance) {
        const presentRecords = recentAttendance.filter(r => r.status === 'present' || r.status === 'late');
        const absentRecords = recentAttendance.filter(r => r.status === 'absent');

        const presenteeCounts = presentRecords.reduce((acc, { student_id }) => ({ ...acc, [student_id]: (acc[student_id] || 0) + 1 }), {});
        const absenteeCounts = absentRecords.reduce((acc, { student_id }) => ({ ...acc, [student_id]: (acc[student_id] || 0) + 1 }), {});

        const sortedPresentees = Object.entries(presenteeCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
        const sortedAbsentees = Object.entries(absenteeCounts).sort(([, a], [, b]) => b - a).slice(0, 5);
        
        const studentIds = [...new Set([...sortedPresentees.map(([id]) => id), ...sortedAbsentees.map(([id]) => id)])];

        if (studentIds.length > 0) {
            const { data: studentDetails, error } = await db.from('students').select('id, name, sections(name, classes(name))').in('id', studentIds);
            if (!error && studentDetails) {
                const studentMap = new Map(studentDetails.map(s => [s.id, { name: s.name, section: s.sections ? `${s.sections.classes.name}-${s.sections.name}` : 'N/A' }]));
                
                sortedAbsentees.forEach(([id, count]) => {
                    const student = studentMap.get(id);
                    if (!student) return;
                    const li = document.createElement('li');
                    li.className = 'flex justify-between items-center text-sm p-2 bg-gray-50 rounded-md';
                    li.innerHTML = `<div><div class="font-medium text-gray-700">${student.name}</div><div class="text-xs text-gray-500">${student.section}</div></div><span class="font-bold text-danger">${count} absences</span>`;
                    topAbsenteesList.appendChild(li);
                });

                sortedPresentees.forEach(([id, count]) => {
                    const student = studentMap.get(id);
                    if (!student) return;
                    const li = document.createElement('li');
                    li.className = 'flex justify-between items-center text-sm p-2 bg-gray-50 rounded-md';
                    li.innerHTML = `<div><div class="font-medium text-gray-700">${student.name}</div><div class="text-xs text-gray-500">${student.section}</div></div><span class="font-bold text-success">${count} days present</span>`;
                    topPresentList.appendChild(li);
                });
            }
        }
    }
    if (topAbsenteesList.children.length === 0) topAbsenteesList.innerHTML = '<p class="text-gray-500">No absences recorded in the last 30 days.</p>';
    if (topPresentList.children.length === 0) topPresentList.innerHTML = '<p class="text-gray-500">No attendance recorded in the last 30 days.</p>';


    // --- Attendance by Section Chart ---
    const sectionAttendance = [];
    if (sectionData && recentAttendance) {
        for (const sec of sectionData) {
            if (!sec.students) continue;
            const studentIdsInSection = sec.students.map(st => st.id);
            const attendanceInSection = recentAttendance.filter(r => studentIdsInSection.includes(r.student_id));
            if (attendanceInSection.length > 0) {
                const presentOrLateCount = attendanceInSection.filter(r => r.status === 'present' || r.status === 'late').length;
                const rate = (presentOrLateCount / attendanceInSection.length) * 100;
                sectionAttendance.push({ name: `${sec.classes.name}-${sec.name}`, rate: rate.toFixed(1) });
            }
        }
    }

    const ctx = document.getElementById('metric-class-attendance-chart').getContext('2d');
    if (classAttendanceChart) {
        classAttendanceChart.destroy();
    }
    classAttendanceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sectionAttendance.map(c => c.name),
            datasets: [{
                label: 'Attendance Rate (%)',
                data: sectionAttendance.map(c => c.rate),
                backgroundColor: 'rgba(79, 70, 229, 0.6)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1,
                borderRadius: 5
            }]
        },
        options: {
            scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (value) => value + '%' } } },
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });
}

// ====================================================
// ATTENDANCE RECORDS (Interactive)
// ====================================================

function getAttendanceStatusBadge(status) {
    const badges = {
      present: '<span class="inline-block px-3 py-1 rounded-full bg-green-100 text-green-800 font-medium text-sm">Present</span>',
      late: '<span class="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-800 font-medium text-sm">Late</span>',
      absent: '<span class="inline-block px-3 py-1 rounded-full bg-red-100 text-red-800 font-medium text-sm">Absent</span>'
    };
    return badges[status] || badges['absent'];
}

async function manualSetStatus(studentId, newStatus) {
    const selectedDate = document.getElementById('attendance-date-picker').value;
    
    const { error } = await db.from('attendance').upsert({
        student_id: studentId,
        date: selectedDate,
        status: newStatus,
        marked_at: new Date().toISOString()
    }, {
        onConflict: 'student_id, date'
    });

    if (error) {
        showNotification(`Failed to update status: ${error.message}`, 'error');
    } else {
        showNotification('Attendance updated successfully!', 'success');
        loadAttendanceData(); // Refresh the table
    }
}

async function loadAttendanceData() {
    const classId = document.getElementById('attendance-class').value;
    const sectionId = document.getElementById('attendance-section').value;
    const selectedDate = document.getElementById('attendance-date-picker').value;
    const tbody = document.getElementById('attendance-table-body');
    const tableContainer = document.getElementById('attendance-table-container');
    const holidayNotice = document.getElementById('attendance-holiday-notice');
    const noData = document.getElementById('no-attendance-data');

    // Reset UI
    tbody.innerHTML = '';
    noData.classList.add('hidden');
    tableContainer.classList.remove('hidden');
    holidayNotice.classList.add('hidden');
    document.getElementById('attendance-present-count').textContent = '--';
    document.getElementById('attendance-late-count').textContent = '--';
    document.getElementById('attendance-absent-count').textContent = '--';

    if (!classId) return;

    // Check for holiday (school-specific)
    const { data: holiday } = await db.from('holidays').select('id').eq('school_id', schoolId).eq('holiday_date', selectedDate).maybeSingle();
    if (holiday) {
        tableContainer.classList.add('hidden');
        holidayNotice.classList.remove('hidden');
        return;
    }

    let studentsQuery = db.from('students').select(`id, name, roll_number, photo_url`);

    // Filter by section if one is selected, otherwise filter by all sections in the class
    if (sectionId) {
        studentsQuery = studentsQuery.eq('section_id', sectionId);
    } else {
        const { data: sections, error: sectionsError } = await db.from('sections').select('id').eq('class_id', classId);
        if (sectionsError || !sections || sections.length === 0) {
            noData.classList.remove('hidden');
            return;
        }
        const sectionIds = sections.map(s => s.id);
        studentsQuery = studentsQuery.in('section_id', sectionIds);
    }

    const { data: students, error: studentsError } = await studentsQuery.order('roll_number');

    if (studentsError || !students || students.length === 0) {
        noData.classList.remove('hidden');
        if (studentsError) console.error(studentsError);
        return;
    }

    // Get attendance records for these students on the selected date
    const studentIds = students.map(s => s.id);
    const { data: attendanceData, error: attendanceError } = await db.from('attendance').select('*').in('student_id', studentIds).eq('date', selectedDate);
    if (attendanceError) {
        console.error(attendanceError);
        return;
    }
    const attendanceMap = new Map(attendanceData.map(record => [record.student_id, record]));

    // Calculate stats and render table
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;

    tbody.innerHTML = students.map(student => {
        const record = attendanceMap.get(student.id);
        const status = record ? record.status : 'absent';
        const time = record && record.marked_at ? new Date(record.marked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit'}) : '---';
        
        if (status === 'present') presentCount++;
        else if (status === 'late') lateCount++;
        else absentCount++;

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td class="py-3 px-4">
                    <div class="flex items-center space-x-3">
                        ${student.photo_url ? `<img src="${student.photo_url}" class="w-10 h-10 rounded-full object-cover">` : `<div class="w-10 h-10 photo-placeholder rounded-full flex items-center justify-center text-white font-semibold text-sm">${getInitials(student.name)}</div>`}
                        <div class="font-medium text-gray-900">${student.name}</div>
                    </div>
                </td>
                <td class="py-3 px-4 text-gray-500">${student.roll_number}</td>
                <td class="py-3 px-4">${getAttendanceStatusBadge(status)}</td>
                <td class="py-3 px-4 text-gray-500">${time}</td>
                <td class="py-3 px-4">
                    <div class="flex space-x-2">
                        <button onclick="manualSetStatus('${student.id}', 'present')" class="px-3 py-1 rounded-lg text-sm font-medium transition-all ${status === 'present' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-green-100 hover:text-green-700'}">Present</button>
                        <button onclick="manualSetStatus('${student.id}', 'late')" class="px-3 py-1 rounded-lg text-sm font-medium transition-all ${status === 'late' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-amber-100 hover:text-amber-700'}">Late</button>
                        <button onclick="manualSetStatus('${student.id}', 'absent')" class="px-3 py-1 rounded-lg text-sm font-medium transition-all ${status === 'absent' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-red-100 hover:text-red-700'}">Absent</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    // Update stat displays
    document.getElementById('attendance-present-count').textContent = presentCount;
    document.getElementById('attendance-late-count').textContent = lateCount;
    document.getElementById('attendance-absent-count').textContent = absentCount;
}

// ====================================================
// SETTINGS
// ====================================================



async function sendLowAttendanceAlerts() {
    const thresholdInput = document.getElementById('low-attendance-threshold');
    const threshold = parseInt(thresholdInput.value, 10);
    const btn = document.getElementById('manual-alert-btn');

    if (isNaN(threshold) || threshold < 1 || threshold > 100) {
        showNotification('Please set a valid Low Attendance Threshold (1-100) before sending alerts.', 'error');
        return;
    }

    if (!confirm(`This will send a WhatsApp alert to all parents of students with attendance below ${threshold}%. Are you sure you want to proceed?`)) {
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
        const { data, error } = await db.functions.invoke('manual-alert', {
            body: { 
                schoolId: schoolId,
                alertType: 'low_attendance',
                threshold: threshold
            }
        });

        if (error) throw error;
        showNotification(data.message || 'Low attendance alert process completed!', 'success');
    } catch (error) {
        showNotification(`Error sending alerts: ${error.message}`, 'error');
        console.error('Manual alert error:', error);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send Low Attendance Alerts Manually';
    }
}


async function loadHolidays() {
    const { data, error } = await db.from('holidays').select('*').eq('school_id', schoolId).order('holiday_date', { ascending: true });
    if (error) { console.error("Error loading holidays:", error); return; }
    const list = document.getElementById('holidays-list');
    list.innerHTML = data.map(h => `
        <li class="flex justify-between items-center p-2 bg-gray-100 rounded-lg">
            <span>${new Date(h.holiday_date).toLocaleDateString()} - ${h.description}</span>
            <button onclick="deleteHoliday('${h.id}')" class="text-red-500 hover:text-red-700">Remove</button>
        </li>
    `).join('');
}

async function loadSettings() {
    const { data, error } = await db.from('school_settings').select('*').eq('school_id', schoolId);
    if (error) {
        console.error("Error loading settings:", error);
        return;
    }

    document.getElementById('late-time').value = '';
    const whatsappEnabledCheckbox = document.getElementById('whatsapp-enabled');
    whatsappEnabledCheckbox.checked = false;
    document.getElementById('consecutive-absence-days').value = '';
    document.getElementById('low-attendance-threshold').value = '';

    data.forEach(setting => {
        if (setting.setting_key === 'late_threshold_time') {
            document.getElementById('late-time').value = setting.setting_value;
        }
        if (setting.setting_key === 'whatsapp_enabled') {
            whatsappEnabledCheckbox.checked = setting.setting_value === 'true';
        }
        if (setting.setting_key === 'consecutive_absence_days') {
            document.getElementById('consecutive-absence-days').value = setting.setting_value;
        }
        if (setting.setting_key === 'low_attendance_threshold') {
            document.getElementById('low-attendance-threshold').value = setting.setting_value;
        }
    });
    
    // Trigger the toggle function to set the initial state of the controls
    toggleWhatsappControls();
}


async function handleHolidayForm(e) {
    e.preventDefault();
    const date = document.getElementById('holiday-date').value;
    const desc = document.getElementById('holiday-desc').value;
    if (!date) return;

    const { error } = await db.from('holidays').insert({ holiday_date: date, description: desc, school_id: schoolId });
    if (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } else {
        showNotification('Holiday added!', 'success');
        await loadHolidays();
        e.target.reset();
    }
}


async function deleteHoliday(id) {
    if (!confirm('Are you sure?')) return;
    const { error } = await db.from('holidays').delete().eq('id', id);
    if (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } else {
        showNotification('Holiday removed.', 'success');
        await loadHolidays();
    }
}

async function handleGeneralSettingsForm(e) {
    e.preventDefault();
    const lateTime = document.getElementById('late-time').value;

    const { error } = await db.from('school_settings').upsert({
        school_id: schoolId,
        setting_key: 'late_threshold_time',
        setting_value: lateTime
    }, { onConflict: 'school_id, setting_key' });

    if (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } else {
        showNotification('Settings saved!', 'success');
    }
}

async function handleWhatsappSettingsForm(e) {
    e.preventDefault();
    const settingsToSave = [
        { school_id: schoolId, setting_key: 'whatsapp_enabled', setting_value: document.getElementById('whatsapp-enabled').checked },
        { school_id: schoolId, setting_key: 'consecutive_absence_days', setting_value: document.getElementById('consecutive-absence-days').value },
        { school_id: schoolId, setting_key: 'low_attendance_threshold', setting_value: document.getElementById('low-attendance-threshold').value }
    ];

    const { error } = await db.from('school_settings').upsert(settingsToSave, { onConflict: 'school_id, setting_key' });
    if (error) {
        showNotification(`Error: ${error.message}`, 'error');
    } else {
        showNotification('WhatsApp settings saved!', 'success');
    }
}

// ====================================================
// STUDENT & CLASS MANAGEMENT
// ====================================================

function resetForm() {
  document.getElementById('student-form').reset();
  document.getElementById('photo-img').classList.add('hidden');
  document.getElementById('photo-initials').style.display = 'flex';
  document.getElementById('photo-initials').textContent = '?';
  document.getElementById('form-title').textContent = 'Register New Student';
  document.getElementById('submit-btn-text').textContent = 'Register Student';
  document.getElementById('cancel-btn').classList.add('hidden');
  editingStudentId = null;
}

function previewPhoto(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('photo-img').src = e.target.result;
      document.getElementById('photo-img').classList.remove('hidden');
      document.getElementById('photo-initials').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
}

async function saveStudent(event) {
  event.preventDefault();
  const name = document.getElementById('student-name').value;
  const sectionId = document.getElementById('student-section').value;
  const roll = document.getElementById('student-roll').value;
  const parentPhone = document.getElementById('parent-phone').value;
  const photoFile = document.getElementById('student-photo').files[0];

  if (!sectionId) {
    showNotification('Please select a class and section.', 'error');
    return;
  }
  try {
    const { data: existingStudent } = await db.from('students').select('id').eq('roll_number', roll).eq('section_id', sectionId).maybeSingle();
    if (existingStudent && existingStudent.id !== editingStudentId) {
      showNotification('Roll number already exists in this section.', 'error');
      return;
    }
    let photo_url = null;
    let face_embedding = null;
    if (photoFile) {
      const filePath = `public/${schoolId}/${Date.now()}-${photoFile.name}`;
      const { error: uploadError } = await db.storage.from('student-photos').upload(filePath, photoFile);
      if (uploadError) throw new Error(`Photo Upload Failed: ${uploadError.message}`);
      const { data: { publicUrl } } = db.storage.from('student-photos').getPublicUrl(filePath);
      photo_url = publicUrl;
      const formData = new FormData();
      formData.append('image', photoFile);
      const response = await fetch(`${FACE_API_URL}/get_embedding`, { method: 'POST', body: formData });
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to get face embedding.');
      }
      const data = await response.json();
      face_embedding = data.embedding;
    }
    const studentData = { name, section_id: sectionId, roll_number: roll, parent_phone_number: parentPhone, school_id: schoolId };
    if (photo_url) studentData.photo_url = photo_url;
    if (face_embedding) studentData.face_embedding = face_embedding;
    if (editingStudentId) {
      const { error } = await db.from('students').update(studentData).eq('id', editingStudentId);
      if (error) throw error;
      showNotification('Student updated successfully!');
    } else {
      const { error } = await db.from('students').insert(studentData);
      if (error) throw error;
      showNotification('Student registered successfully!');
    }
    resetForm();
    await renderStudentsTable();
  } catch (error) {
    console.error('Error saving student:', error);
    showNotification(`Error: ${error.message}`, 'error');
  }
}

async function editStudent(id) {
  const { data: student, error } = await db.from('students').select(`*, sections(*, classes(*))`).eq('id', id).single();
  if (error) {
    showNotification('Failed to fetch student details.', 'error');
    return;
  }
  editingStudentId = id;
  document.getElementById('student-name').value = student.name;
  document.getElementById('student-class').value = student.sections.classes.id;
  await updateSectionOptions(student.sections.classes.id, student.section_id);
  document.getElementById('student-roll').value = student.roll_number;
  document.getElementById('parent-phone').value = student.parent_phone_number;
  if (student.photo_url) {
    document.getElementById('photo-img').src = student.photo_url;
    document.getElementById('photo-img').classList.remove('hidden');
    document.getElementById('photo-initials').style.display = 'none';
  } else {
    document.getElementById('photo-img').classList.add('hidden');
    document.getElementById('photo-initials').style.display = 'flex';
    document.getElementById('photo-initials').textContent = getInitials(student.name);
  }
  document.getElementById('form-title').textContent = 'Edit Student Details';
  document.getElementById('submit-btn-text').textContent = 'Update Student';
  document.getElementById('cancel-btn').classList.remove('hidden');
  showTab('students');
}

async function deleteStudent(id) {
  if (confirm('Are you sure?')) {
    const { error } = await db.from('students').delete().eq('id', id);
    if (error) {
      showNotification(`Error: ${error.message}`, 'error');
    } else {
      showNotification('Student deleted successfully!');
      await renderStudentsTable();
    }
  }
}

async function renderStudentsTable() {
    const searchTerm = document.getElementById('student-search').value.toLowerCase();
    let query = db.from('students').select(`*, sections(name, classes(name))`).eq('school_id', schoolId);
    if (searchTerm) {
        query = query.ilike('name', `%${searchTerm}%`);
    }
    const { data: students, error } = await query.order('name');
    const tbody = document.getElementById('students-table-body');
    const noStudents = document.getElementById('no-students');
    if (error || !students || students.length === 0) {
        tbody.innerHTML = '';
        noStudents.classList.remove('hidden');
        document.getElementById('student-count').textContent = '0 Total';
        if (error) console.error('Error fetching students:', error);
        return;
    }
    noStudents.classList.add('hidden');
    tbody.innerHTML = students.map(student => `
    <tr class="border-b border-gray-50 hover:bg-blue-50/50">
      <td class="py-4 px-4">${student.photo_url ? `<img src="${student.photo_url}" class="w-12 h-12 rounded-full object-cover">` : `<div class="w-12 h-12 photo-placeholder rounded-full flex items-center justify-center"><span class="text-white font-bold text-sm">${getInitials(student.name)}</span></div>`}</td>
      <td class="py-4 px-4 font-semibold text-gray-900">${student.name}</td>
      <td class="py-4 px-4 text-gray-600">${student.sections.classes.name}</td>
      <td class="py-4 px-4 text-gray-600">${student.roll_number}</td>
      <td class="py-4 px-4"><div class="flex space-x-2"><button onclick="editStudent('${student.id}')" class="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200">Edit</button><button onclick="deleteStudent('${student.id}')" class="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200">Delete</button></div></td>
    </tr>`).join('');
    document.getElementById('student-count').textContent = `${students.length} Total`;
}

async function addClass(event) {
    event.preventDefault();
    const name = document.getElementById('new-class').value.trim();
    if (!name) return;
    const { error } = await db.from('classes').insert({ name, school_id: schoolId });
    if (error) {
        showNotification(error.code === '23505' ? 'Class name already exists.' : `Error: ${error.message}`, 'error');
    } else {
        showNotification('Class added successfully!');
        document.getElementById('new-class').value = '';
        await Promise.all([renderClassesList(), updateClassSelectors()]);
    }
}


async function addSection(event) {
    event.preventDefault();
    const class_id = document.getElementById('section-class').value;
    const name = document.getElementById('new-section').value.trim();
    if (!class_id || !name) return;
    try {
        const { error } = await db.from('sections').insert({ name, class_id });
        if (error) throw error;
        showNotification('Section added successfully!');
        document.getElementById('new-section').value = '';
        await renderSectionsList();
    } catch (error) {
        showNotification(error.code === '23505' ? 'Section already exists in this class.' : `Error: ${error.message}`, 'error');
    }
}

async function renderClassesList() {
    const { data, error } = await db.from('classes').select('*').eq('school_id', schoolId).order('name');
    if (error) return;
    const container = document.getElementById('classes-list');
    container.innerHTML = data.map(c => `
        <div class="flex justify-between items-center p-2 bg-blue-100 rounded-lg">
            <span class="text-blue-800 font-medium">${c.name}</span>
            <button onclick="deleteClass('${c.id}')" class="text-red-500 hover:text-red-700">Delete</button>
        </div>
    `).join('');
}

async function deleteClass(id) {
    if (confirm('Are you sure you want to delete this class? This will also delete all associated sections and students.')) {
        const { error } = await db.from('classes').delete().eq('id', id);
        if (error) {
            showNotification(`Error: ${error.message}`, 'error');
        } else {
            showNotification('Class deleted successfully!');
            await renderClassesList();
            await updateClassSelectors();
        }
    }
}

async function renderSectionsList() {
    const class_id = document.getElementById('section-class').value;
    const container = document.getElementById('sections-list');
    if (!class_id) {
        container.innerHTML = '<span class="text-gray-500 text-sm">Select a class to see sections</span>';
        return;
    }
    const { data, error } = await db.from('sections').select('*').eq('class_id', class_id).order('name');
    if (error) return;
    const { data: classData } = await db.from('classes').select('name').eq('id', class_id).single();
    container.innerHTML = data.map(s => `
        <div class="flex justify-between items-center p-2 bg-orange-100 rounded-lg">
            <span class="text-orange-800 font-medium">${classData.name}-${s.name}</span>
            <button onclick="deleteSection('${s.id}')" class="text-red-500 hover:text-red-700">Delete</button>
        </div>
    `).join('');
}

async function deleteSection(id) {
    if (confirm('Are you sure you want to delete this section? This will also delete all associated students.')) {
        const { error } = await db.from('sections').delete().eq('id', id);
        if (error) {
            showNotification(`Error: ${error.message}`, 'error');
        } else {
            showNotification('Section deleted successfully!');
            await renderSectionsList();
        }
    }
}


async function updateClassSelectors() {
    const { data, error } = await db.from('classes').select('*').eq('school_id', schoolId).order('name');
    if (error) return;
    const selectors = ['student-class', 'section-class', 'attendance-class'];
    const options = '<option value="">Select Class</option>' + data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    selectors.forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = options;
    });
    const studentClassEl = document.getElementById('student-class');
    if(studentClassEl) {
      studentClassEl.addEventListener('change', (e) => updateSectionOptions(e.target.value));
    }
    const sectionClassEl = document.getElementById('section-class');
    if(sectionClassEl) {
      sectionClassEl.addEventListener('change', renderSectionsList);
    }
}

async function updateSectionOptions(classId, selectedSectionId = null) {
    const sectionSelect = document.getElementById('student-section');
    if (!sectionSelect) return;
    if (!classId) {
        sectionSelect.innerHTML = '<option value="">Select Section</option>';
        return;
    }
    const { data, error } = await db.from('sections').select('*').eq('class_id', classId).order('name');
    if (error) return;
    sectionSelect.innerHTML = '<option value="">Select Section</option>' + data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    if (selectedSectionId) {
        sectionSelect.value = selectedSectionId;
    }
}

async function updateAttendanceSectionOptions(classId) {
    const sectionSelect = document.getElementById('attendance-section');
    if (!sectionSelect) return;
    if (!classId) {
        sectionSelect.innerHTML = '<option value="">All Sections</option>';
        return;
    }
    const { data, error } = await db.from('sections').select('*').eq('class_id', classId).order('name');
    if (error) return;
    // Add "All Sections" as the first option
    sectionSelect.innerHTML = '<option value="">All Sections</option>' + data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}