import { useEffect, useMemo, useState } from 'react'
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { auth, db, isFirebaseReady, studentAuth, studentDb } from './firebase'
import './App.css'

const STORAGE_KEY = 'edigix-demo-state-v1'
const TEACHER_SESSION_KEY = 'edigix-teacher-session-v1'
const STUDENT_SESSION_KEY = 'edigix-student-session-v1'

const createId = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`

const defaultState = {
  teachers: [
    {
      id: 'teacher-ada',
      name: 'Ada Johnson',
      email: 'ada@edigix.com',
      password: 'teacher123',
      school: 'BrightStar Academy',
    },
  ],
  students: [
    {
      id: 'student-sam',
      teacherId: 'teacher-ada',
      fullName: 'Samuel Mensah',
      email: 'samuel@example.com',
      phone: '0241000001',
      className: 'JSS 2',
    },
    {
      id: 'student-lina',
      teacherId: 'teacher-ada',
      fullName: 'Lina Boateng',
      email: 'lina@example.com',
      phone: '0241000002',
      className: 'Grade 8',
    },
  ],
  questions: [
    {
      id: 'q-1',
      teacherId: 'teacher-ada',
      prompt: 'What is the capital city of Ghana?',
      options: ['Accra', 'Kumasi', 'Tamale', 'Takoradi'],
      correctIndex: 0,
      isTimed: true,
      timeLimit: 30,
    },
    {
      id: 'q-2',
      teacherId: 'teacher-ada',
      prompt: 'Which planet is known as the Red Planet?',
      options: ['Venus', 'Mars', 'Jupiter', 'Mercury'],
      correctIndex: 1,
      isTimed: false,
      timeLimit: 0,
    },
    {
      id: 'q-3',
      teacherId: 'teacher-ada',
      prompt: 'Which organ pumps blood around the body?',
      options: ['Lungs', 'Heart', 'Kidney', 'Liver'],
      correctIndex: 1,
      isTimed: true,
      timeLimit: 45,
    },
  ],
  results: [
    {
      id: 'result-1',
      teacherId: 'teacher-ada',
      studentId: 'student-sam',
      score: 2,
      total: 3,
      submittedAt: '2026-08-19T09:00:00.000Z',
      answers: { 'q-1': 0, 'q-2': 3, 'q-3': 1 },
    },
  ],
}

const getStoredState = () => {
  if (typeof window === 'undefined') {
    return defaultState
  }

  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (!saved) {
    return defaultState
  }

  try {
    return JSON.parse(saved)
  } catch {
    return defaultState
  }
}

const getStoredTeacherSession = () => {
  if (typeof window === 'undefined') {
    return null
  }

  const saved = window.localStorage.getItem(TEACHER_SESSION_KEY)
  if (!saved) {
    return null
  }

  try {
    return JSON.parse(saved)
  } catch {
    return null
  }
}

const getStoredStudentSession = () => {
  if (typeof window === 'undefined') {
    return null
  }

  const saved = window.localStorage.getItem(STUDENT_SESSION_KEY)
  if (!saved) {
    return null
  }

  try {
    return JSON.parse(saved)
  } catch {
    return null
  }
}

const buildTeacherProfile = (teacherId, data) => ({
  id: teacherId,
  name: data.name || 'Teacher',
  email: data.email || '',
  password: data.password || '',
  school: data.school || 'EDIGIX Academy',
})

const getAuthErrorMessage = (error, fallback) => {
  const messages = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/email-already-in-use': 'An account already exists for this email.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Authentication.',
    'auth/network-request-failed': 'Network error. Check your internet connection.',
    'auth/too-many-requests': 'Firebase temporarily blocked sign-in attempts from this network. Wait a few minutes, then try once with the correct password.',
    'permission-denied': 'Firestore denied this request. Check your Firestore security rules.',
    'failed-precondition': 'Firestore needs an index or database setup before this request can run.',
  }

  return messages[error?.code] || error?.message || fallback
}

const buildQuestionFromRow = (row, teacherId) => {
  const optionValues = ['optionA', 'optionB', 'optionC', 'optionD']
    .map((key) => row[key])
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')

  if (!row.question || optionValues.length < 2) {
    return null
  }

  let correctIndex = Number(row.correctIndex ?? row.answerIndex ?? row.correctAnswer ?? 0)
  const correctKey = String(row.correctAnswerText ?? row.answer ?? '').trim().toLowerCase()

  if (correctKey) {
    const matchedIndex = optionValues.findIndex(
      (value) => String(value).trim().toLowerCase() === correctKey,
    )
    if (matchedIndex !== -1) {
      correctIndex = matchedIndex
    }
  }

  if (Number.isNaN(correctIndex) || correctIndex < 0) {
    correctIndex = 0
  }

  return {
    id: createId('question'),
    teacherId,
    prompt: String(row.question).trim(),
    options: optionValues.slice(0, 4).map((value) => String(value).trim()),
    correctIndex: Math.min(correctIndex, optionValues.length - 1),
    isTimed: Boolean(row.isTimed === true || row.timed === true || row.timeLimit),
    timeLimit: Number(row.timeLimit ?? row.duration ?? 30) || 30,
  }
}

const emptyQuestionForm = {
  prompt: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  isTimed: false,
  timeLimit: 30,
}

function App() {
  const [state, setState] = useState(getStoredState)
  const [activeView, setActiveView] = useState('home')
  const [teacherForm, setTeacherForm] = useState({
    name: '',
    email: '',
    password: '',
    school: '',
  })
  const [teacherLogin, setTeacherLogin] = useState({ email: '', password: '' })
  const [teacherAuthError, setTeacherAuthError] = useState('')
  const [teacherSession, setTeacherSession] = useState(getStoredTeacherSession)
  const [studentForm, setStudentForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    className: '',
    password: '',
    teacherId: '',
  })
  const [selectedTeacherId, setSelectedTeacherId] = useState(
    getStoredState().teachers[0]?.id || '',
  )
  const [questionForm, setQuestionForm] = useState(emptyQuestionForm)
  const [studentLogin, setStudentLogin] = useState({ email: '', password: '' })
  const [studentAuthError, setStudentAuthError] = useState('')
  const [studentLoginLoading, setStudentLoginLoading] = useState(false)
  const [studentSession, setStudentSession] = useState(getStoredStudentSession)
  const [answers, setAnswers] = useState({})
  const [submissionSummary, setSubmissionSummary] = useState(null)

  useEffect(() => {
    if (!isFirebaseReady) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }
  }, [state])

  useEffect(() => {
    if (!isFirebaseReady) {
      return
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setTeacherSession(null)
        return
      }

      try {
        const teacherRef = doc(db, 'teachers', user.uid)
        const teacherSnap = await getDoc(teacherRef)
        if (!teacherSnap.exists()) {
          setTeacherSession(null)
          return
        }

        const profile = { id: user.uid, ...teacherSnap.data() }

        setTeacherSession(profile)
        setStudentSession(null)
        setSelectedTeacherId(profile.id)

        setState((previous) => ({
          ...previous,
          teachers: previous.teachers.some((teacher) => teacher.id === profile.id)
            ? previous.teachers
            : [...previous.teachers, buildTeacherProfile(profile.id, profile)],
        }))
      } catch (error) {
        console.error('Teacher auth sync failed:', error)
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!isFirebaseReady) {
      return
    }

    const unsubscribe = onAuthStateChanged(studentAuth, async (user) => {
      if (!user) {
        return
      }

      try {
        const studentSnapshot = await getDoc(doc(studentDb, 'students', user.uid))
        if (!studentSnapshot.exists()) {
          await signOut(studentAuth)
          setStudentSession(null)
          return
        }

        setStudentSession({ id: studentSnapshot.id, ...studentSnapshot.data() })
        setActiveView('student')
      } catch (error) {
        console.error('Student auth sync failed:', error)
        setStudentAuthError(getAuthErrorMessage(error, 'Student profile could not be loaded.'))
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!isFirebaseReady || !teacherSession?.id) {
      return
    }

    const loadTeacherFirestoreData = async () => {
      try {
        const teacherId = teacherSession.id
        const studentsQuery = query(collection(db, 'students'), where('teacherId', '==', teacherId))
        const questionsQuery = query(collection(db, 'questions'), where('teacherId', '==', teacherId))
        const resultsQuery = query(collection(db, 'results'), where('teacherId', '==', teacherId))

        const [studentSnapshot, questionSnapshot, resultSnapshot] = await Promise.all([
          getDocs(studentsQuery),
          getDocs(questionsQuery),
          getDocs(resultsQuery),
        ])

        setState((previous) => ({
          ...previous,
          students: studentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
          questions: questionSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
          results: resultSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
        }))
      } catch (error) {
        console.error('Failed to load Firestore teacher data:', error)
      }
    }

    loadTeacherFirestoreData()
  }, [teacherSession?.id])

  useEffect(() => {
    if (teacherSession) {
      window.localStorage.setItem(TEACHER_SESSION_KEY, JSON.stringify(teacherSession))
    } else {
      window.localStorage.removeItem(TEACHER_SESSION_KEY)
    }
  }, [teacherSession])

  useEffect(() => {
    if (studentSession) {
      window.localStorage.setItem(STUDENT_SESSION_KEY, JSON.stringify(studentSession))
    } else {
      window.localStorage.removeItem(STUDENT_SESSION_KEY)
    }
  }, [studentSession])

  useEffect(() => {
    if (!selectedTeacherId && state.teachers[0]) {
      setSelectedTeacherId(state.teachers[0].id)
    }
  }, [selectedTeacherId, state.teachers])

  useEffect(() => {
    if (teacherSession && teacherSession.id) {
      setSelectedTeacherId(teacherSession.id)
    }
  }, [teacherSession])

  const currentTeacher = useMemo(
    () => state.teachers.find((item) => item.id === selectedTeacherId) || state.teachers[0],
    [selectedTeacherId, state.teachers],
  )

  const teacherStudents = useMemo(
    () => state.students.filter((student) => student.teacherId === currentTeacher?.id),
    [currentTeacher, state.students],
  )

  const teacherQuestions = useMemo(
    () => state.questions.filter((question) => question.teacherId === currentTeacher?.id),
    [currentTeacher, state.questions],
  )

  const teacherResults = useMemo(
    () => state.results.filter((result) => result.teacherId === currentTeacher?.id),
    [currentTeacher, state.results],
  )

  const studentQuestions = useMemo(
    () => state.questions.filter((question) => question.teacherId === studentSession?.teacherId),
    [state.questions, studentSession],
  )

  const answeredCount = studentQuestions.filter((question) => answers[question.id] !== undefined).length
  const progressPercentage = studentQuestions.length
    ? Math.round((answeredCount / studentQuestions.length) * 100)
    : 0

  const handleTeacherRegister = async (event) => {
    event.preventDefault()
    setTeacherAuthError('')
    const cleanName = teacherForm.name.trim()
    const cleanEmail = teacherForm.email.trim().toLowerCase()

    if (!cleanName || !cleanEmail || !teacherForm.password.trim()) {
      return
    }

    const duplicateTeacher = state.teachers.some((teacher) => teacher.email === cleanEmail)
    if (!isFirebaseReady && duplicateTeacher) {
      setTeacherAuthError('A local teacher account already exists for this email.')
      return
    }

    if (isFirebaseReady) {
      try {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          cleanEmail,
          teacherForm.password.trim(),
        )

        const teacherProfile = {
          id: userCredential.user.uid,
          name: cleanName,
          email: cleanEmail,
          password: teacherForm.password.trim(),
          school: teacherForm.school.trim() || 'EDIGIX Academy',
        }

        await setDoc(doc(db, 'teachers', userCredential.user.uid), {
          name: cleanName,
          email: cleanEmail,
          school: teacherProfile.school,
          createdAt: new Date().toISOString(),
        })

        setState((previous) => ({
          ...previous,
          teachers: previous.teachers.some((teacher) => teacher.id === teacherProfile.id)
            ? previous.teachers
            : [...previous.teachers, teacherProfile],
        }))
        setTeacherSession(teacherProfile)
        setSelectedTeacherId(teacherProfile.id)
        setTeacherForm({ name: '', email: '', password: '', school: '' })
        setActiveView('teacher')
        return
      } catch (error) {
        console.error('Teacher registration failed:', error)
        setTeacherAuthError(getAuthErrorMessage(error, 'Teacher registration failed.'))
        return
      }
    }

    const newTeacher = {
      id: createId('teacher'),
      name: cleanName,
      email: cleanEmail,
      password: teacherForm.password.trim(),
      school: teacherForm.school.trim() || 'EDIGIX Academy',
    }

    setState((previous) => ({
      ...previous,
      teachers: [...previous.teachers, newTeacher],
    }))
    setTeacherSession(newTeacher)
    setSelectedTeacherId(newTeacher.id)
    setTeacherForm({ name: '', email: '', password: '', school: '' })
    setActiveView('teacher')
  }

  const handleTeacherLogin = async (event) => {
    event.preventDefault()
    setTeacherAuthError('')
    const email = teacherLogin.email.trim().toLowerCase()
    const password = teacherLogin.password.trim()

    if (!email || !password) {
      setTeacherAuthError('Enter both email and password.')
      return
    }

    if (isFirebaseReady) {
      try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password)
        const profileSnapshot = await getDoc(doc(db, 'teachers', userCredential.user.uid))
        const profile = profileSnapshot.exists()
          ? { id: userCredential.user.uid, ...profileSnapshot.data(), password }
          : {
              id: userCredential.user.uid,
              name: userCredential.user.email?.split('@')[0] || 'Teacher',
              email: userCredential.user.email || email,
              password,
              school: 'EDIGIX Academy',
            }

        setTeacherSession(profile)
        setSelectedTeacherId(profile.id)
        setTeacherLogin({ email: '', password: '' })
        setActiveView('teacher')
        return
      } catch (error) {
        console.error('Teacher login failed:', error)
        setTeacherAuthError(getAuthErrorMessage(error, 'Teacher login failed.'))
        return
      }
    }

    const account = state.teachers.find(
      (teacher) => teacher.email === email && teacher.password === password,
    )

    if (!account) {
      return
    }

    setTeacherSession(account)
    setSelectedTeacherId(account.id)
    setTeacherLogin({ email: '', password: '' })
    setActiveView('teacher')
  }

  const handleTeacherLogout = async () => {
    if (isFirebaseReady) {
      await signOut(auth)
      await signOut(studentAuth)
    }

    setTeacherSession(null)
    setStudentSession(null)
    setAnswers({})
    setSubmissionSummary(null)
    setActiveView('home')
  }

  const handleStudentRegister = async (event) => {
    event.preventDefault()
    setStudentAuthError('')
    const teacherId = teacherSession?.id || studentForm.teacherId || selectedTeacherId

    if (!teacherId) {
      return
    }

    if (!studentForm.fullName.trim() || !studentForm.email.trim() || !studentForm.password.trim()) {
      setStudentAuthError('Enter the student name, email, and password.')
      return
    }

    if (studentForm.password.trim().length < 6) {
      setStudentAuthError('Student password must be at least 6 characters.')
      return
    }

    const newStudent = {
      id: createId('student'),
      teacherId,
      fullName: studentForm.fullName.trim(),
      email: studentForm.email.trim().toLowerCase(),
      phone: studentForm.phone.trim(),
      className: studentForm.className.trim(),
      password: studentForm.password.trim(),
    }

    if (isFirebaseReady) {
      try {
        const userCredential = await createUserWithEmailAndPassword(
          studentAuth,
          newStudent.email,
          newStudent.password,
        )
        const studentPayload = {
          uid: userCredential.user.uid,
          teacherId,
          fullName: newStudent.fullName,
          email: newStudent.email,
          phone: newStudent.phone,
          className: newStudent.className,
          createdAt: new Date().toISOString(),
        }

        await setDoc(doc(db, 'students', userCredential.user.uid), studentPayload)
        await signOut(studentAuth)
        const storedStudent = { id: userCredential.user.uid, ...studentPayload }

        setState((previous) => ({
          ...previous,
          students: [...previous.students, storedStudent],
        }))
        setStudentForm({ fullName: '', email: '', phone: '', className: '', password: '', teacherId: '' })
        setActiveView('teacher')
        return
      } catch (error) {
        console.error('Student registration failed:', error)
        setStudentAuthError(getAuthErrorMessage(error, 'Student registration failed.'))
        return
      }
    }

    setState((previous) => ({
      ...previous,
      students: [...previous.students, newStudent],
    }))
    setStudentForm({ fullName: '', email: '', phone: '', className: '', password: '', teacherId: '' })
    setActiveView('teacher')
  }

  const handleQuestionAdd = async (event) => {
    event.preventDefault()
    const trimmedPrompt = questionForm.prompt.trim()
    const validOptions = questionForm.options.map((option) => option.trim()).filter(Boolean)

    if (!trimmedPrompt || validOptions.length < 2) {
      return
    }

    const finalQuestion = {
      id: createId('question'),
      teacherId: currentTeacher?.id,
      prompt: trimmedPrompt,
      options: validOptions.slice(0, 4),
      correctIndex: Math.min(questionForm.correctIndex, validOptions.length - 1),
      isTimed: questionForm.isTimed,
      timeLimit: Number(questionForm.timeLimit) || 0,
    }

    if (isFirebaseReady && currentTeacher?.id) {
      try {
        const questionPayload = {
          teacherId: currentTeacher.id,
          prompt: finalQuestion.prompt,
          options: finalQuestion.options,
          correctIndex: finalQuestion.correctIndex,
          isTimed: finalQuestion.isTimed,
          timeLimit: finalQuestion.timeLimit,
          createdAt: new Date().toISOString(),
        }

        const questionRef = await addDoc(collection(db, 'questions'), questionPayload)
        const storedQuestion = { id: questionRef.id, ...questionPayload }

        setState((previous) => ({
          ...previous,
          questions: [...previous.questions, storedQuestion],
        }))
        setQuestionForm(emptyQuestionForm)
        return
      } catch (error) {
        console.error('Question creation failed:', error)
      }
    }

    setState((previous) => ({
      ...previous,
      questions: [...previous.questions, finalQuestion],
    }))
    setQuestionForm(emptyQuestionForm)
  }

  const handleExcelUpload = async (event) => {
    const file = event.target.files[0]
    if (!file || !currentTeacher) {
      return
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    const importedQuestions = rows
      .map((row) => buildQuestionFromRow(row, currentTeacher.id))
      .filter(Boolean)

    if (!importedQuestions.length) {
      return
    }

    setState((previous) => ({
      ...previous,
      questions: [...previous.questions, ...importedQuestions],
    }))
    event.target.value = ''
  }

  const handleStudentLogin = async (event) => {
    event.preventDefault()
    if (studentLoginLoading) {
      return
    }

    setStudentLoginLoading(true)
    setStudentAuthError('')

    const email = studentLogin.email.trim().toLowerCase()
    const password = studentLogin.password.trim()
    let account = null

    if (!email || !password) {
      setStudentAuthError('Enter both email and password.')
      setStudentLoginLoading(false)
      return
    }

    if (isFirebaseReady) {
      try {
        const userCredential = await signInWithEmailAndPassword(studentAuth, email, password)
        const studentSnapshot = await getDoc(doc(studentDb, 'students', userCredential.user.uid))

        if (!studentSnapshot.exists()) {
          await signOut(studentAuth)
          setStudentAuthError('This Firebase account is not registered as a student.')
          setStudentLoginLoading(false)
          return
        }

        account = { id: studentSnapshot.id, ...studentSnapshot.data() }
        const questionSnapshot = await getDocs(
          query(collection(studentDb, 'questions'), where('teacherId', '==', account.teacherId)),
        )

        setState((previous) => ({
          ...previous,
          students: previous.students.some((student) => student.id === account.id)
            ? previous.students.map((student) => (student.id === account.id ? account : student))
            : [...previous.students, account],
          questions: questionSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
        }))
      } catch (error) {
        console.error('Student login failed:', error)
        setStudentAuthError(getAuthErrorMessage(error, 'Student login failed. Check your Firestore rules.'))
        setStudentLoginLoading(false)
        return
      }
    }

    if (!account) {
      account = state.students.find(
        (student) => student.email === email && student.password === password,
      )
    }

    if (!account) {
      setStudentAuthError('No student account matches that email and password.')
      setStudentLoginLoading(false)
      return
    }

    setStudentSession(account)
    setAnswers({})
    setSubmissionSummary(null)
    setActiveView('student')
    setStudentLoginLoading(false)
  }

  const handleAnswerSelection = (questionId, optionIndex) => {
    setAnswers((previous) => ({
      ...previous,
      [questionId]: optionIndex,
    }))
  }

  const handleSubmission = async () => {
    if (!studentSession || !studentQuestions.length) {
      return
    }

    const total = studentQuestions.length
    const score = studentQuestions.reduce((count, question) => {
      return count + (answers[question.id] === question.correctIndex ? 1 : 0)
    }, 0)

    const result = {
      id: createId('result'),
      teacherId: studentSession.teacherId,
      studentId: studentSession.id,
      score,
      total,
      submittedAt: new Date().toISOString(),
      answers,
    }

    if (isFirebaseReady) {
      try {
        const resultPayload = {
          teacherId: result.teacherId,
          studentId: result.studentId,
          score: result.score,
          total: result.total,
          answers: result.answers,
          submittedAt: result.submittedAt,
        }

        const resultRef = await addDoc(collection(studentDb, 'results'), resultPayload)
        setState((previous) => ({
          ...previous,
          results: [{ id: resultRef.id, ...resultPayload }, ...previous.results],
        }))
      } catch (error) {
        console.error('Result save failed:', error)
      }
    }

    setState((previous) => ({
      ...previous,
      results: [result, ...previous.results],
    }))
    setSubmissionSummary({ score, total })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">E-learning quiz platform</p>
          <h1>EDIGIX</h1>
        </div>
        <nav className="topbar-nav">
          <button type="button" onClick={() => setActiveView('home')}>
            Home
          </button>
          <button type="button" onClick={() => setActiveView('teacher')}>
            {teacherSession ? 'Teacher Portal' : 'Teacher Login'}
          </button>
          <button type="button" onClick={() => setActiveView('student')}>
            Student Portal
          </button>
        </nav>
      </header>

      {activeView === 'home' && (
        <main className="landing-page">
          <section className="hero-panel">
            <div className="hero-copy">
              <span className="badge">Smart assessments</span>
              <h2>Make every classroom question count.</h2>
              <p>
                A focused space for teachers to build better assessments and students to practice
                with confidence.
              </p>
              <div className="hero-actions">
                <button type="button" onClick={() => setActiveView('student')}>Student portal</button>
                <button type="button" className="button-light" onClick={() => setActiveView('teacher')}>
                  Teacher workspace
                </button>
              </div>
            </div>
            <div className="hero-metrics">
              <div>
                <strong>{state.teachers.length}</strong>
                <span>Teachers</span>
              </div>
              <div>
                <strong>{state.students.length}</strong>
                <span>Students</span>
              </div>
              <div>
                <strong>{state.questions.length}</strong>
                <span>Questions</span>
              </div>
            </div>
          </section>

          <section className="feature-grid">
            <article className="feature-card feature-card-teacher">
              <span className="feature-kicker">For educators</span>
              <h3>One calm workspace for the busy work.</h3>
              <p>Build question banks, manage your roster, and see performance without losing the thread.</p>
              <ul>
                <li>Register teachers and add students</li>
                <li>Create questions one by one or import from Excel</li>
                <li>Enable timed or untimed assessment sessions</li>
                <li>Review student results from the results dashboard</li>
              </ul>
            </article>
            <article className="feature-card feature-card-student">
              <span className="feature-kicker">For learners</span>
              <h3>Practice that shows you where to grow.</h3>
              <p>Take focused quizzes, get instant feedback, and keep your progress visible.</p>
              <ul>
                <li>Log in with email and password</li>
                <li>See answered progress with a live progress bar</li>
                <li>Submit quizzes and review correct vs incorrect answers</li>
                <li>Track performance instantly after submission</li>
              </ul>
            </article>
          </section>
        </main>
      )}

      {activeView === 'teacher' && (
        <main className="dashboard-grid">
          {!teacherSession ? (
            <>
              <section className="panel">
                <h2>Teacher login</h2>
                <form className="form-card" onSubmit={handleTeacherLogin}>
                  <label>
                    Email
                    <input
                      type="email"
                      value={teacherLogin.email}
                      onChange={(event) =>
                        setTeacherLogin((previous) => ({ ...previous, email: event.target.value }))
                      }
                      placeholder="teacher@email.com"
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={teacherLogin.password}
                      onChange={(event) =>
                        setTeacherLogin((previous) => ({ ...previous, password: event.target.value }))
                      }
                      placeholder="Enter your password"
                    />
                  </label>
                  {teacherAuthError && <p className="auth-error">{teacherAuthError}</p>}
                  <button type="submit">Login as teacher</button>
                </form>
              </section>

              <section className="panel">
                <h2>Teacher registration</h2>
                <form className="form-card" onSubmit={handleTeacherRegister}>
                  <label>
                    Full name
                    <input
                      value={teacherForm.name}
                      onChange={(event) =>
                        setTeacherForm((previous) => ({ ...previous, name: event.target.value }))
                      }
                      placeholder="Teacher name"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      value={teacherForm.email}
                      onChange={(event) =>
                        setTeacherForm((previous) => ({ ...previous, email: event.target.value }))
                      }
                      placeholder="teacher@email.com"
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={teacherForm.password}
                      onChange={(event) =>
                        setTeacherForm((previous) => ({ ...previous, password: event.target.value }))
                      }
                      placeholder="Create a password"
                    />
                  </label>
                  <label>
                    School / Institution
                    <input
                      value={teacherForm.school}
                      onChange={(event) =>
                        setTeacherForm((previous) => ({ ...previous, school: event.target.value }))
                      }
                      placeholder="School name"
                    />
                  </label>
                  <button type="submit">Register teacher</button>
                </form>
              </section>
            </>
          ) : (
            <>
              <section className="panel dashboard-intro panel-wide">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Teacher workspace</p>
                    <h2>{teacherSession.name}</h2>
                    <p className="school-name">{teacherSession.school || 'EDIGIX Academy'}</p>
                  </div>
                  <div className="intro-actions">
                    <span className="status-pill">Workspace live</span>
                    <button type="button" className="button-secondary" onClick={handleTeacherLogout}>Log out</button>
                  </div>
                </div>
              </section>

              <section className="stat-grid panel-wide">
                <article className="stat-card"><span>Students</span><strong>{teacherStudents.length}</strong><small>in your roster</small></article>
                <article className="stat-card"><span>Questions</span><strong>{teacherQuestions.length}</strong><small>ready to use</small></article>
                <article className="stat-card"><span>Submissions</span><strong>{teacherResults.length}</strong><small>results recorded</small></article>
              </section>

              <section className="panel">
                <h2>Register students</h2>
                <form className="form-card" onSubmit={handleStudentRegister}>
                  <label>
                    Select teacher
                    <select
                      value={studentForm.teacherId || selectedTeacherId || ''}
                      onChange={(event) => {
                        setSelectedTeacherId(event.target.value)
                        setStudentForm((previous) => ({ ...previous, teacherId: event.target.value }))
                      }}
                    >
                      {state.teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Student name
                    <input
                      value={studentForm.fullName}
                      onChange={(event) =>
                        setStudentForm((previous) => ({ ...previous, fullName: event.target.value }))
                      }
                      placeholder="Student full name"
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      value={studentForm.email}
                      onChange={(event) =>
                        setStudentForm((previous) => ({ ...previous, email: event.target.value }))
                      }
                      placeholder="student@email.com"
                    />
                  </label>
                  <label>
                    Phone number
                    <input
                      value={studentForm.phone}
                      onChange={(event) =>
                        setStudentForm((previous) => ({ ...previous, phone: event.target.value }))
                      }
                      placeholder="0240000000"
                    />
                  </label>
                  <label>
                    Class
                    <input
                      value={studentForm.className}
                      onChange={(event) =>
                        setStudentForm((previous) => ({ ...previous, className: event.target.value }))
                      }
                      placeholder="JSS 2"
                    />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={studentForm.password}
                      onChange={(event) =>
                        setStudentForm((previous) => ({ ...previous, password: event.target.value }))
                      }
                      placeholder="At least 6 characters"
                    />
                  </label>
                  {studentAuthError && <p className="auth-error">{studentAuthError}</p>}
                  <button type="submit">Add student</button>
                </form>
              </section>

              <section className="panel panel-wide">
                <div className="section-header">
                  <h2>Teacher dashboard</h2>
                  <select
                    value={selectedTeacherId || ''}
                    onChange={(event) => setSelectedTeacherId(event.target.value)}
                  >
                    {state.teachers.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="teacher-grid">
                  <div>
                    <h3>Question builder</h3>
                    <form className="form-card" onSubmit={handleQuestionAdd}>
                      <label>
                        Question prompt
                        <textarea
                          value={questionForm.prompt}
                          onChange={(event) =>
                            setQuestionForm((previous) => ({ ...previous, prompt: event.target.value }))
                          }
                          placeholder="Type your question"
                        />
                      </label>

                      {questionForm.options.map((option, index) => (
                        <label key={`option-${index}`}>
                          Option {index + 1}
                          <input
                            value={option}
                            onChange={(event) => {
                              const nextOptions = [...questionForm.options]
                              nextOptions[index] = event.target.value
                              setQuestionForm((previous) => ({ ...previous, options: nextOptions }))
                            }}
                            placeholder={`Answer option ${index + 1}`}
                          />
                        </label>
                      ))}

                      <div className="inline-row">
                        <label>
                          Correct answer
                          <select
                            value={questionForm.correctIndex}
                            onChange={(event) =>
                              setQuestionForm((previous) => ({
                                ...previous,
                                correctIndex: Number(event.target.value),
                              }))
                            }
                          >
                            {questionForm.options.map((option, index) => (
                              <option key={index} value={index}>
                                Option {index + 1}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Time limit (minutes)
                          <input
                            type="number"
                            min="0"
                            value={questionForm.timeLimit}
                            onChange={(event) =>
                              setQuestionForm((previous) => ({
                                ...previous,
                                timeLimit: Number(event.target.value),
                              }))
                            }
                          />
                        </label>
                      </div>

                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={questionForm.isTimed}
                          onChange={(event) =>
                            setQuestionForm((previous) => ({
                              ...previous,
                              isTimed: event.target.checked,
                            }))
                          }
                        />
                        Timed question
                      </label>

                      <button type="submit">Save question</button>
                    </form>
                  </div>

                  <div>
                    <h3>Excel import</h3>
                    <label className="upload-box">
                      <span>Upload .xlsx or .csv</span>
                      <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} />
                    </label>
                    <p className="helper-text">
                      Use columns named question, optionA, optionB, optionC, optionD, and correctAnswer.
                    </p>
                    <div className="mini-list">
                      {teacherQuestions.map((question) => (
                        <div key={question.id} className="mini-card">
                          <strong>{question.prompt}</strong>
                          <span>
                            {question.isTimed ? `Timed • ${question.timeLimit} mins` : 'Untimed'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="panel">
                <h2>Student roster</h2>
                <div className="list-stack">
                  {teacherStudents.map((student) => (
                    <div key={student.id} className="list-row">
                      <div>
                        <strong>{student.fullName}</strong>
                        <span>{student.className}</span>
                      </div>
                      <div>
                        <span>{student.email}</span>
                        <span>{student.phone}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel">
                <h2>Student results</h2>
                <div className="list-stack">
                  {teacherResults.map((result) => {
                    const student = state.students.find((item) => item.id === result.studentId)
                    return (
                      <div key={result.id} className="result-card">
                        <div>
                          <strong>{student?.fullName || 'Unknown student'}</strong>
                          <span>
                            {result.score}/{result.total} correct
                          </span>
                        </div>
                        <div className="score-bar">
                          <span style={{ width: `${(result.score / result.total) * 100}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </>
          )}
        </main>
      )}

      {activeView === 'student' && (
        <main className="student-view">
          {!studentSession ? (
            <section className="panel login-panel">
              <h2>Student login</h2>
              <form className="form-card" onSubmit={handleStudentLogin}>
                <label>
                  Email
                  <input
                    type="email"
                    value={studentLogin.email}
                    onChange={(event) =>
                      setStudentLogin((previous) => ({ ...previous, email: event.target.value }))
                    }
                    placeholder="student@email.com"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={studentLogin.password}
                    onChange={(event) =>
                      setStudentLogin((previous) => ({ ...previous, password: event.target.value }))
                    }
                    placeholder="Enter your password"
                  />
                </label>
                {studentAuthError && <p className="auth-error">{studentAuthError}</p>}
                <button type="submit" disabled={studentLoginLoading}>
                  {studentLoginLoading ? 'Signing in...' : 'Login'}
                </button>
              </form>
            </section>
          ) : (
            <>
              <section className="panel student-header dashboard-intro">
                <div>
                  <p className="eyebrow">Student dashboard</p>
                  <h2>Welcome back, {studentSession.fullName.split(' ')[0]}</h2>
                  <p className="school-name">Your practice space is ready when you are.</p>
                </div>
                <div className="intro-actions">
                  <span className="status-pill">Ready to learn</span>
                  <button
                    type="button"
                  onClick={async () => {
                    if (isFirebaseReady) {
                      await signOut(studentAuth)
                    }
                    setStudentSession(null)
                    setAnswers({})
                    setSubmissionSummary(null)
                    setActiveView('home')
                  }}
                  >Log out</button>
                </div>
              </section>

              <section className="stat-grid">
                <article className="stat-card"><span>Questions</span><strong>{studentQuestions.length}</strong><small>available today</small></article>
                <article className="stat-card"><span>Answered</span><strong>{answeredCount}</strong><small>of {studentQuestions.length || 0} completed</small></article>
                <article className="stat-card"><span>Progress</span><strong>{progressPercentage}%</strong><small>current completion</small></article>
              </section>

              <section className="panel">
                <div className="progress-header">
                  <span>Progress</span>
                  <strong>{progressPercentage}%</strong>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${progressPercentage}%` }} />
                </div>
              </section>

              <section className="quiz-stack">
                {studentQuestions.map((question, index) => {
                  const selectedIndex = answers[question.id]
                  const isCorrect = submissionSummary && selectedIndex === question.correctIndex
                  const isWrong = submissionSummary && selectedIndex !== undefined && selectedIndex !== question.correctIndex

                  return (
                    <article key={question.id} className="quiz-card panel">
                      <div className="question-meta">
                        <span>
                          Question {index + 1}
                        </span>
                        <span>
                          {question.isTimed ? `Timed • ${question.timeLimit} mins` : 'Untimed'}
                        </span>
                      </div>
                      <h3>{question.prompt}</h3>

                      <div className="options-grid">
                        {question.options.map((option, optionIndex) => {
                          const isSelected = selectedIndex === optionIndex
                          const isRightAnswer = submissionSummary && optionIndex === question.correctIndex

                          return (
                            <button
                              key={`${question.id}-${optionIndex}`}
                              type="button"
                              className={[
                                'option-button',
                                isSelected ? 'selected' : '',
                                isRightAnswer ? 'correct' : '',
                                isWrong && isSelected ? 'wrong' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onClick={() => !submissionSummary && handleAnswerSelection(question.id, optionIndex)}
                            >
                              {option}
                            </button>
                          )
                        })}
                      </div>

                      {submissionSummary && (
                        <p className={`result-note ${isCorrect ? 'success' : 'error'}`}>
                          {isCorrect
                            ? 'Correct answer.'
                            : `Incorrect. Correct answer: ${question.options[question.correctIndex]}`}
                        </p>
                      )}
                    </article>
                  )
                })}
              </section>

              {!submissionSummary ? (
                <button className="submit-button" type="button" onClick={handleSubmission}>
                  Submit quiz
                </button>
              ) : (
                <section className="panel summary-box">
                  <h3>Submission summary</h3>
                  <p>
                    You scored {submissionSummary.score} out of {submissionSummary.total}
                  </p>
                </section>
              )}
            </>
          )}
        </main>
      )}
    </div>
  )
}

export default App
