// ====================================================
// SUPABASE & API CONFIGURATION
// ====================================================
const SUPABASE_URL = 'https://samikiantytgcxlbtqnp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhbWlraWFudHl0Z2N4bGJ0cW5wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc0MTU2NTMsImV4cCI6MjA3Mjk5MTY1M30.VDbliaiLO0km0UAAnJe0fejYHHVVgc5c_DCBrePW29I';
<<<<<<< HEAD
const FACE_API_URL = 'http://localhost:5000'; // Use the Vercel API route
=======
const FACE_API_URL = import.meta.env.VITE_FACE_API_URL || 'http://localhost:5000'; // Replace with your actual face API URL
const RECOGNITION_INTERVAL = 2000; // ms between recognition attempts
const SIMILARITY_THRESHOLD = 0.5; // Cosine similarity threshold for a match
>>>>>>> 5b17125beb2fbaf08493d6c094f39ea3ef69a0fe

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ====================================================
// DOM ELEMENTS & GLOBAL STATE
// ====================================================
// Setup View
const setupView = document.getElementById('setup-view');
const selectClass = document.getElementById('select-class');
const selectSection = document.getElementById('select-section');
const startSessionBtn = document.getElementById('start-session-btn');

// Camera View
const cameraView = document.getElementById('camera-view');
const video = document.getElementById('video');
const recognitionStatus = document.getElementById('recognition-status');
const studentNameEl = document.getElementById('student-name');
const studentClassEl = document.getElementById('student-class');
const studentSectionEl = document.getElementById('student-section');
const studentRollEl = document.getElementById('student-roll');
const confirmBtn = document.getElementById('confirm-attendance-btn');
const rejectBtn = document.getElementById('reject-attendance-btn');


// Global State
let stream = null;
let recognitionIntervalId = null;
let isRecognizing = false;
let selectedSectionId = null;
let currentStudent = null;
let schoolId = null;
let lateThresholdTime = null; 

// Caching
const recentlyMarkedCache = new Map(); // In-memory cache for recently marked students
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const RECOGNITION_INTERVAL = 2000;
const SIMILARITY_THRESHOLD = 0.5;

// ====================================================
// INITIALIZATION
// ====================================================
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.href = '/attd-log.html';
    return;
  }

  updateDateTime();
  setInterval(updateDateTime, 60000);

  setupEventListeners();
  populateClassDropdown();
  
  document.getElementById('logout-btn').addEventListener('click', async () => {
    sessionStorage.clear(); // Clear cache on logout
    await db.auth.signOut();
    window.location.href = '/attd-log.html';
  });
});

function setupEventListeners() {
    selectClass.addEventListener('change', () => populateSectionDropdown(selectClass.value));
    selectSection.addEventListener('change', () => {
        startSessionBtn.disabled = !selectSection.value;
    });
    startSessionBtn.addEventListener('click', startAttendanceSession);
    confirmBtn.addEventListener('click', confirmAndMark);
    rejectBtn.addEventListener('click', handleIncorrectRecognition);
}

// ====================================================
// SETUP FLOW WITH CACHING
// ====================================================
async function populateClassDropdown() {
    const cacheKey = `school_${schoolId}_classes`;
    const cachedClasses = sessionStorage.getItem(cacheKey);

    if (cachedClasses) {
        selectClass.innerHTML = cachedClasses;
        return;
    }

    const { data: { user } } = await db.auth.getUser();
    const { data: schoolData, error: schoolError } = await db.from('schools').select('id').eq('user_id', user.id).single();
    if (schoolError || !schoolData) {
        showNotification('Could not identify the school for this user.', 'error');
        return;
    }
    schoolId = schoolData.id;

    const { data, error } = await db.from('classes').select('*').eq('school_id', schoolId).order('name');
    if (error) {
        showNotification('Failed to load classes', 'error');
        return;
    }
    const optionsHtml = '<option value="">Select a Class</option>' + data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    selectClass.innerHTML = optionsHtml;
    sessionStorage.setItem(cacheKey, optionsHtml); // Store in cache
}

async function populateSectionDropdown(classId) {
    selectSection.innerHTML = '<option value="">Loading...</option>';
    selectSection.disabled = true;
    startSessionBtn.disabled = true;

    if (!classId) {
        selectSection.innerHTML = '<option value="">Select a class first</option>';
        return;
    }

    const cacheKey = `class_${classId}_sections`;
    const cachedSections = sessionStorage.getItem(cacheKey);

    if (cachedSections) {
        selectSection.innerHTML = cachedSections;
        selectSection.disabled = false;
        return;
    }

    const { data, error } = await db.from('sections').select('*').eq('class_id', classId).order('name');
    if (error) {
        showNotification('Failed to load sections', 'error');
        return;
    }
    const optionsHtml = '<option value="">Select a Section</option>' + data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    selectSection.innerHTML = optionsHtml;
    sessionStorage.setItem(cacheKey, optionsHtml); // Store in cache
    selectSection.disabled = false;
}

async function startAttendanceSession() {
    selectedSectionId = selectSection.value;
    if (!selectedSectionId) {
        showNotification('Please select a section before starting.', 'error');
        return;
    }
    recentlyMarkedCache.clear();

    const { data, error } = await db.from('school_settings')
        .select('setting_value')
        .eq('school_id', schoolId)
        .eq('setting_key', 'late_threshold_time')
        .single();
    
    if (error) {
        console.warn("Could not fetch late time setting. Defaulting to present.", error);
    } else if (data) {
        lateThresholdTime = data.setting_value;
    }

    setupView.classList.add('hidden');
    cameraView.classList.remove('hidden');
    startCamera();
}

// ====================================================
// UTILITY FUNCTIONS
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

function updateDateTime() {
  const now = new Date();
  document.getElementById('current-date').textContent = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}


// ====================================================
// CAMERA & RECOGNITION LOGIC
// ====================================================
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    video.srcObject = stream;
    await video.play();
    document.getElementById('camera-status').style.background = '#06b6d4';
    showNotification('Camera activated. Ready to scan.', 'success');
    startRecognitionLoop();
  } catch (err) {
    console.error("Camera Error:", err);
    document.getElementById('permission-error').textContent = 'Camera access denied. Please allow camera permissions in your browser.';
    document.getElementById('permission-error').classList.remove('hidden');
    document.getElementById('camera-status').style.background = '#ef4444';
  }
}

function startRecognitionLoop() {
    if (recognitionIntervalId) clearInterval(recognitionIntervalId);
    recognitionIntervalId = setInterval(recognizeFace, RECOGNITION_INTERVAL);
    recognitionStatus.textContent = '🔍 Scanning...';
}

function stopRecognitionLoop() {
    clearInterval(recognitionIntervalId);
    recognitionIntervalId = null;
}

async function recognizeFace() {
    if (isRecognizing || !stream || video.readyState < 4) return;
    isRecognizing = true;
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        isRecognizing = false;
        return;
    }
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
        if (!blob) {
            isRecognizing = false;
            return;
        }
        try {
            const formData = new FormData();
            formData.append('image', blob);
            const response = await fetch(`${FACE_API_URL}/get_embedding`, { method: 'POST', body: formData });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                recognitionStatus.textContent = errorData.error || 'No face detected.';
                isRecognizing = false;
                return;
            }
            const { embedding } = await response.json();
            
            const { data: student, error } = await db.rpc('match_student_in_section', {
                p_section_id: selectedSectionId,
                query_embedding: embedding,
                match_threshold: SIMILARITY_THRESHOLD,
                match_count: 1
            });
            if (error) throw error;

            if (student && student.length > 0) {
                const matchedStudent = student[0];
                
                // Check in-memory cache first
                if (recentlyMarkedCache.has(matchedStudent.id) && (Date.now() - recentlyMarkedCache.get(matchedStudent.id) < CACHE_DURATION_MS)) {
                    handleAlreadyMarked(matchedStudent);
                    return;
                }

                const today = new Date().toISOString().split('T')[0];
                const { data: attendanceRecord, error: attendanceError } = await db
                    .from('attendance')
                    .select('status')
                    .eq('student_id', matchedStudent.id)
                    .eq('date', today)
                    .in('status', ['present', 'late'])
                    .maybeSingle();
                
                if (attendanceError) console.error("Error checking attendance status:", attendanceError);

                if (attendanceRecord) {
                    recentlyMarkedCache.set(matchedStudent.id, Date.now()); // Update cache
                    handleAlreadyMarked(matchedStudent);
                } else {
                    handleRecognitionSuccess(matchedStudent);
                }
            } else {
                recognitionStatus.textContent = '❓ Unknown face.';
            }
        } catch (error) {
            console.error('Recognition Error:', error);
            if (error.message.includes('Failed to fetch')) {
                showNotification('Could not connect to the face recognition API.', 'error');
                stopRecognitionLoop();
            }
        } finally {
            isRecognizing = false;
        }
    }, 'image/jpeg');
}

function handleRecognitionSuccess(student) {
    stopRecognitionLoop();
    currentStudent = student;
    updateStudentInfo(student);
    recognitionStatus.textContent = `✅ Found: ${student.name.split(' ')[0]}!`;
    confirmBtn.disabled = false;
    rejectBtn.disabled = false;
}

function handleAlreadyMarked(student) {
    stopRecognitionLoop();
    updateStudentInfo(student);
    recognitionStatus.textContent = `👍 Already marked, ${student.name.split(' ')[0]}.`;
    confirmBtn.disabled = true;
    rejectBtn.disabled = true;

    const display = document.getElementById('attendance-status');
    const statusText = document.getElementById('status-text');
    const statusTime = document.getElementById('status-time');
    display.classList.remove('hidden');
    statusText.textContent = "Already Marked";
    statusTime.textContent = `Resuming scan...`;
    display.className = 'p-4 rounded-xl text-center bg-blue-100 border border-blue-200 mt-4';
    statusText.className = 'text-lg font-bold text-blue-800';

    setTimeout(() => {
        clearStudentInfo();
        display.classList.add('hidden');
        startRecognitionLoop();
    }, 2500);
}


function handleIncorrectRecognition() {
    clearStudentInfo();
    showNotification('Scan reset. Looking for the next student.', 'success');
    startRecognitionLoop();
}

// ====================================================
// ATTENDANCE MARKING
// ====================================================
function confirmAndMark() {
    if (!currentStudent) return;

    let status = 'present'; 
    
    if (lateThresholdTime) {
        const now = new Date();
        const [hours, minutes] = lateThresholdTime.split(':');
        const thresholdDate = new Date();
        thresholdDate.setHours(hours, minutes, 0, 0);

        if (now > thresholdDate) {
            status = 'late';
        }
    }
    
    markAttendance(currentStudent.id, status);
}

async function markAttendance(studentId, status) {
    confirmBtn.disabled = true;
    rejectBtn.disabled = true;
    const today = new Date().toISOString().split('T')[0];

    const { error } = await db.from('attendance').upsert({
        student_id: studentId,
        date: today,
        status: status,
        marked_at: new Date().toISOString()
    }, { onConflict: 'student_id, date' });

    if (error) {
        showNotification(`Failed to mark attendance: ${error.message}`, 'error');
        confirmBtn.disabled = false;
        rejectBtn.disabled = false;
    } else {
        showNotification(`Marked ${currentStudent.name} as ${status}!`, 'success');
        recentlyMarkedCache.set(studentId, Date.now()); // Add to cache on success
        updateStatusDisplay(status);
        setTimeout(() => {
            clearStudentInfo();
            document.getElementById('attendance-status').classList.add('hidden');
            startRecognitionLoop();
        }, 2000);
    }
}

// ====================================================
// UI UPDATES
// ====================================================
function updateStudentInfo(student) {
    studentNameEl.textContent = student.name;
    studentClassEl.textContent = student.class_name;
    studentSectionEl.textContent = student.section_name;
    studentRollEl.textContent = student.roll_number;
}

function clearStudentInfo() {
    currentStudent = null;
    studentNameEl.textContent = '--';
    studentClassEl.textContent = '--';
    studentSectionEl.textContent = '--';
    studentRollEl.textContent = '--';
    confirmBtn.disabled = true;
    rejectBtn.disabled = true;
}

function updateStatusDisplay(status) {
    const display = document.getElementById('attendance-status');
    const statusText = document.getElementById('status-text');
    const statusTime = document.getElementById('status-time');
    display.classList.remove('hidden');
    statusText.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    statusTime.textContent = `Marked at ${new Date().toLocaleTimeString()}`;
    if (status === 'present') {
        display.className = 'p-4 rounded-xl text-center bg-green-100 border border-green-200 mt-4';
        statusText.className = 'text-lg font-bold text-green-800';
    } else if (status === 'late') {
        display.className = 'p-4 rounded-xl text-center bg-amber-100 border border-amber-200 mt-4';
        statusText.className = 'text-lg font-bold text-amber-800';
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    stopRecognitionLoop();
});
