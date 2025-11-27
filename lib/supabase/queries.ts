import { supabase, getCurrentAthleteId } from './client'
import { Activity, PlannedWorkout, TrainingPlan, Athlete } from '@/types'

export async function getAthleteProfile() {
    const { data, error } = await supabase
        .from('athletes')
        .select('*')
        .eq('id', getCurrentAthleteId())
        .single()

    if (error) throw error
    return data as Athlete
}

export async function getRecentActivities(limit = 5) {
    const { data, error } = await supabase
        .from('activities')
        .select('*')
        .eq('athlete_id', getCurrentAthleteId())
        .order('start_time', { ascending: false })
        .limit(limit)

    if (error) throw error
    return data as Activity[]
}

export async function getActiveTrainingPlan() {
    const { data, error } = await supabase
        .from('training_plans')
        .select('*')
        .eq('athlete_id', getCurrentAthleteId())
        .eq('status', 'active')
        .single()

    if (error && error.code !== 'PGRST116') throw error // Ignore not found error
    return data as TrainingPlan | null
}

export async function getPlannedWorkoutsForDateRange(startDate: string, endDate: string) {
    const { data, error } = await supabase
        .from('planned_workouts')
        .select('*')
        .eq('athlete_id', getCurrentAthleteId())
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .order('scheduled_date', { ascending: true })

    if (error) throw error
    return data as PlannedWorkout[]
}
