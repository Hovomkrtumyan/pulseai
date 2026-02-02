document.addEventListener('DOMContentLoaded', function() {
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.getElementById('browseBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const uploadForm = document.getElementById('uploadForm');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const loadingContainer = document.getElementById('loadingContainer');
    const resultContainer = document.getElementById('resultContainer');
    const resultContent = document.getElementById('resultContent');
    const noResultsMessage = document.getElementById('noResultsMessage');
    const copyBtn = document.getElementById('copyBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    
    // Auth elements
    const loginBtn = document.getElementById('loginBtn');
    const userProfileBtn = document.getElementById('userProfileBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userName = document.getElementById('userName');
    
    console.log('Auth elements found:', { 
        loginBtn: !!loginBtn, 
        userProfileBtn: !!userProfileBtn, 
        logoutBtn: !!logoutBtn, 
        userName: !!userName 
    });
    
    let selectedFile = null;
    let currentAnalysisResult = null;
    let currentUser = null;
    
    // Check authentication status
    checkAuthStatus();
    
    // Authentication functions
    function checkAuthStatus() {
        const token = localStorage.getItem('token');
        const user = localStorage.getItem('user');
        
        console.log('Checking auth status:', { hasToken: !!token, hasUser: !!user });
        
        if (token && user) {
            try {
                currentUser = JSON.parse(user);
                console.log('User logged in:', currentUser);
                showUserProfile();
            } catch (e) {
                console.error('Error parsing user:', e);
                window.location.href = '/login.html';
            }
        } else {
            console.log('No user logged in, redirecting to login');
            window.location.href = '/login.html';
        }
    }
    
    function showLoginButton() {
        loginBtn.style.display = 'inline-flex';
        userProfileBtn.style.display = 'none';
        logoutBtn.style.display = 'none';
    }
    
    function showUserProfile() {
        console.log('Showing user profile for:', currentUser?.name || currentUser?.email);
        if (loginBtn) loginBtn.style.display = 'none';
        if (userProfileBtn) {
            userProfileBtn.style.display = 'inline-flex';
            userProfileBtn.style.visibility = 'visible';
        }
        if (logoutBtn) {
            logoutBtn.style.display = 'inline-flex';
            logoutBtn.style.visibility = 'visible';
            console.log('Logout button should be visible now');
        }
        if (userName) userName.textContent = currentUser.name || currentUser.email;
    }
    
    if (loginBtn) {
        loginBtn.addEventListener('click', function() {
            window.location.href = '/login.html';
        });
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('Logout button clicked - executing logout');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            currentUser = null;
            console.log('LocalStorage cleared, redirecting...');
            window.location.href = '/login.html';
        });
        console.log('Logout event listener attached');
    } else {
        console.error('Logout button not found!');
    }
    
    // Browse button click event
    browseBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
    });
    
    // File input change event
    fileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            handleFile(this.files[0]);
        }
    });
    
    // Drag and drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, unhighlight, false);
    });
    
    function highlight() {
        dropArea.classList.add('active');
    }
    
    function unhighlight() {
        dropArea.classList.remove('active');
    }
    
    dropArea.addEventListener('drop', function(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });
    
    // Handle selected file
    function handleFile(file) {
        if (file.type !== 'text/csv' && !file.name.toLowerCase().endsWith('.csv')) {
            showError('Please select a CSV file from your logic analyzer.');
            return;
        }
        
        // Check file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
            showError('File too large. Maximum size is 5MB.');
            return;
        }
        
        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);
        fileInfo.style.display = 'block';
        analyzeBtn.disabled = false;
        
        // Set the file for the form
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
    }
    
    // Format file size
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // Form submission event
    uploadForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        if (!selectedFile) {
            showError('Please select a file first.');
            return;
        }
        
        // Show loading, hide results
        showLoadingState(true);
        
        try {
            const formData = new FormData(uploadForm);
            
            const response = await fetch('/api/analyze', {
                method: 'POST',
                body: formData,
                headers: {
                    'Authorization': currentUser ? `Bearer ${localStorage.getItem('token')}` : ''
                }
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `Server error: ${response.status}`);
            }
            
            if (data.success) {
                // Display results
                currentAnalysisResult = data.result;
                resultContent.textContent = data.result;
                resultContainer.style.display = 'block';
                noResultsMessage.style.display = 'none';
                
                // Show success message
                showSuccess('Analysis completed successfully!');
            } else {
                throw new Error(data.error || 'Analysis failed');
            }
            
        } catch (error) {
            console.error('Error:', error);
            showError('Analysis failed: ' + error.message);
        } finally {
            showLoadingState(false);
        }
    });
    
    // Show/hide loading state
    function showLoadingState(show) {
        if (show) {
            loadingContainer.style.display = 'block';
            resultContainer.style.display = 'none';
            analyzeBtn.disabled = true;
        } else {
            loadingContainer.style.display = 'none';
            analyzeBtn.disabled = false;
        }
    }
    
    // Show error message
    function showError(message) {
        // Create or use a notification system
        alert('Error: ' + message);
    }
    
    // Show success message
    function showSuccess(message) {
        // Create or use a notification system
        console.log('Success:', message);
    }
    
    // Copy results button
    copyBtn.addEventListener('click', function() {
        if (!currentAnalysisResult) return;
        
        navigator.clipboard.writeText(currentAnalysisResult).then(function() {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.textContent = originalText;
            }, 2000);
        }).catch(function(err) {
            console.error('Failed to copy:', err);
            showError('Failed to copy to clipboard');
        });
    });
    
    // Download results button
    downloadBtn.addEventListener('click', function() {
        if (!currentAnalysisResult) return;
        
        const blob = new Blob([currentAnalysisResult], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pulseai-analysis-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
});