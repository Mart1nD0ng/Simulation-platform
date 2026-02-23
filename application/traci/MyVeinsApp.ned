//
// Copyright (C) 2016 David Eckhoff <david.eckhoff@fau.de>
//
// Documentation for these modules is at http://veins.car2x.org/
//
// SPDX-License-Identifier: GPL-2.0-or-later
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
//

package org.car2x.veins.modules.application.traci;
import org.car2x.veins.modules.application.ieee80211p.DemoBaseApplLayer;

//
// V2X-enabled intersection management application with fixed state-machine-based strategy.
// 
// This application implements a finite state machine (FSM) for vehicle behavior at intersections.
// Each vehicle periodically collects observations, decides an action based on the current state,
// and applies the action by controlling vehicle speed via TraCI.
//
// The FSM is designed to be modular so that the decision logic can later be replaced
// with a MARL (Multi-Agent Reinforcement Learning) policy.
//
simple MyVeinsApp extends DemoBaseApplLayer
{
    parameters:
        @class(veins::MyVeinsApp);
        string appName = default("V2X Intersection Manager");
        
        // ========== Decision Making Parameters ==========
        
        // Interval between decision steps (how often the FSM makes decisions)
        double decisionInterval @unit(s) = default(0.2s);
        
        // ========== Intersection Configuration ==========
        
        // Coordinates of the intersection center (must match your SUMO network)
        // Default values are placeholders - adjust based on your scenario
        double intersectionCenterX @unit(m) = default(500m);
        double intersectionCenterY @unit(m) = default(500m);
        
        // Radius of the intersection conflict zone
        double intersectionRadius @unit(m) = default(15m);
        
        // Distance from intersection center to stop line
        double stopLineOffset @unit(m) = default(20m);
        
        // ========== Action Parameters ==========
        
        // Speed change magnitude for SLOW_DOWN action
        double slowDownDelta @unit(mps) = default(2.0mps);
        
        // Speed change magnitude for ACCELERATE action
        double accelerateDelta @unit(mps) = default(2.0mps);
        
        // Minimum allowed speed (lower bound for speed control)
        double minSpeed @unit(mps) = default(0.0mps);
        
        // Maximum allowed speed (upper bound for speed control)
        double maxSpeed @unit(mps) = default(13.89mps); // ~50 km/h
        
        // ========== Communication Parameters ==========
        
        // Time after which neighbor information is considered stale
        double neighborTimeout @unit(s) = default(2.0s);
        
        // ========== Statistics ==========
        
        @signal[vehicleState](type=long);
        @statistic[vehicleState](title="Vehicle State"; source=vehicleState; record=vector,stats; interpolationmode=sample-hold);
}
