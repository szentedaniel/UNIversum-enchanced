import React from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { setLoading } from '../Store/slices/loadingSlice'


function Loading(loading) {
  const { isLoading } = useSelector((state) => state.loading)

  return (
    <>
      {(isLoading) &&
        <div className='w-full h-full fixed block top-0 left-0 bg-[#01162ead] opacity-25 z-50'>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="relative">
              <svg width="100" height="100" viewBox="0 0 44 44" xmlns="http://www.w3.org/2000/svg"
                stroke="#fff">
                <g fill="none" fillRule="evenodd" strokeWidth="2">
                  <circle cx="22" cy="22" r="1">
                    <animate attributeName="r" begin="0s" dur="1.8s" values="1; 20" calcMode="spline"
                      keyTimes="0; 1" keySplines="0.165, 0.84, 0.44, 1" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" begin="0s" dur="1.8s" values="1; 0"
                      calcMode="spline" keyTimes="0; 1" keySplines="0.3, 0.61, 0.355, 1"
                      repeatCount="indefinite" />
                  </circle>
                  <circle cx="22" cy="22" r="1">
                    <animate attributeName="r" begin="-0.9s" dur="1.8s" values="1; 20"
                      calcMode="spline" keyTimes="0; 1" keySplines="0.165, 0.84, 0.44, 1"
                      repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" begin="-0.9s" dur="1.8s" values="1; 0"
                      calcMode="spline" keyTimes="0; 1" keySplines="0.3, 0.61, 0.355, 1"
                      repeatCount="indefinite" />
                  </circle>
                </g>
              </svg>
            </div>
          </div>
        </div>
      }
    </>
  )
}

export default Loading
