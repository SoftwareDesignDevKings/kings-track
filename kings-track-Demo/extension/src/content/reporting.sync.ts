(function () {
  self.KingsTrackExtension = self.KingsTrackExtension || {}
  const ext = self.KingsTrackExtension
  const logDebug = ext.logDebug
    ? (...args) => ext.logDebug(...args)
    : async () => {}

  ext.runReportingSync = async function runReportingSync(deps) {
    const selectedClass = await deps.getSelectedClass()
    const students = await deps.listStudents()
    const imports = []
    const failures = []

    await logDebug('reporting', 'sync_context_ready', {
      classId: selectedClass.id,
      className: selectedClass.name,
      studentCount: students.length,
    })

    for (let index = 0; index < students.length; index += 1) {
      const student = students[index]
      await logDebug('reporting', 'student_export_started', {
        className: selectedClass.name,
        current: index + 1,
        total: students.length,
        studentId: student.id,
        studentName: student.name,
      })
      deps.onProgress({
        phase: 'exporting_student',
        current: index + 1,
        total: students.length,
        studentName: student.name,
        className: selectedClass.name,
      })
      try {
        await deps.selectStudent(student)
        const studentImport = await deps.collectCurrentStudentImport({
          selectedClass,
          student,
          progress: (progress) => deps.onProgress({
            phase: 'collecting_student_results',
            current: index + 1,
            total: students.length,
            studentName: student.name,
            className: selectedClass.name,
            ...progress,
          }),
        })
        await logDebug('reporting', 'student_results_collected', {
          studentId: studentImport.gradeo_student_id,
          studentName: studentImport.student_name,
          rowCount: studentImport.rows.length,
        })
        imports.push(studentImport)
      } catch (error) {
        const failure = {
          studentId: student.id,
          studentName: student.name,
          error: String(error),
        }
        failures.push(failure)
        await logDebug('reporting', 'student_export_failed', {
          className: selectedClass.name,
          current: index + 1,
          total: students.length,
          ...failure,
        })
        deps.onProgress({
          phase: 'student_failed',
          current: index + 1,
          total: students.length,
          studentName: student.name,
          className: selectedClass.name,
          error: String(error),
        })
      }
    }

    if (imports.length === 0) {
      const error = new Error(`Failed to collect any reporting rows for ${selectedClass.name}`)
      await logDebug('reporting', 'class_collection_failed', {
        classId: selectedClass.id,
        className: selectedClass.name,
        studentCount: students.length,
        failedStudents: failures.length,
        failures,
      })
      throw error
    }

    await logDebug('reporting', 'class_payload_built', {
      classId: selectedClass.id,
      className: selectedClass.name,
      students: imports.length,
      failedStudents: failures.length,
      failures: failures.slice(0, 10),
    })
    deps.onProgress({
      phase: 'class_ready',
      current: students.length,
      total: students.length,
      className: selectedClass.name,
    })

    return {
      gradeo_class_id: selectedClass.id,
      gradeo_class_name: selectedClass.name,
      students: imports,
    }
  }
})()
